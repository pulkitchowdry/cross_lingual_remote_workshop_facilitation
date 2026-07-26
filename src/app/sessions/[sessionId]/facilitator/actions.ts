"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ParticipantRole, SessionStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { hasFacilitatorAccess } from "@/lib/session-access";
import { publishTranslatedCaption } from "@/lib/captions";
import { generateAndPersistSessionSummary } from "@/lib/insights";
import { facilitatorCookieName, hashToken } from "@/lib/session-security";
import type { FormActionResult, SupportedLanguage } from "@/lib/session-contracts";
import { isSupportedLanguage } from "@/lib/i18n";

export async function updateFacilitatorLanguage(sessionId: string, lang: SupportedLanguage) {
  if (!(await hasFacilitatorAccess(sessionId))) redirect("/setup");
  if (!isSupportedLanguage(lang)) return;

  await prisma.session.update({ where: { id: sessionId }, data: { sourceLanguage: lang } });
  revalidatePath(`/sessions/${sessionId}/facilitator`);
}

export async function startSession(sessionId: string) {
  if (!(await hasFacilitatorAccess(sessionId))) redirect("/setup");

  // Guarded to only leave DRAFT — without this, a stale tab's "Start Session"
  // button (still bound from before the session was ended) or a resubmitted form
  // could flip an already-LIVE or already-ENDED session back to LIVE. Clearing
  // `endedAt` matters even more than the status guard alone: isSessionRetentionExpired
  // anchors its deadline on `endedAt` when present, so a session restarted without
  // clearing a stale `endedAt` could immediately compute as retention-expired and
  // 404 for everyone — including the facilitator who just "restarted" it — while the
  // retention cleanup cron itself skips it outright (it excludes status=LIVE), an
  // inconsistent, self-locking state.
  const { count } = await prisma.session.updateMany({
    where: { id: sessionId, status: SessionStatus.DRAFT },
    data: { status: SessionStatus.LIVE, startedAt: new Date(), endedAt: null },
  });
  if (count === 0) {
    throw new Error("This session has already started or ended.");
  }
  revalidatePath(`/sessions/${sessionId}/facilitator`);
  revalidatePath(`/sessions/${sessionId}/learn`);
}

export async function endSession(sessionId: string) {
  if (!(await hasFacilitatorAccess(sessionId))) redirect("/setup");

  const session = await prisma.session.update({
    where: { id: sessionId },
    data: { status: SessionStatus.ENDED, endedAt: new Date() },
  });
  // Fire-and-forget, same pattern as generateSessionInsights (see captions.ts) — this
  // process stays alive after the response is sent, so a plain unawaited call is enough
  // to let the summary finish generating without making "End session" wait on a Claude
  // call. POST_SESSION_INSIGHT_GRACE_MS's short post-end poll (facilitator/page.tsx)
  // is what picks the result up once it lands.
  void generateAndPersistSessionSummary(session).catch((error) => {
    console.error("generateAndPersistSessionSummary failed", error);
  });
  revalidatePath(`/sessions/${sessionId}/facilitator`);
  revalidatePath(`/sessions/${sessionId}/learn`);
}

export async function publishCaption(
  sessionId: string,
  _prevState: FormActionResult,
  formData: FormData,
): Promise<FormActionResult> {
  if (!(await hasFacilitatorAccess(sessionId))) redirect("/setup");

  const captionText = formData.get("captionText");
  if (typeof captionText !== "string" || !captionText.trim() || captionText.trim().length > 3_000) {
    return { error: "Enter a caption of up to 3,000 characters." };
  }

  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session || session.status !== SessionStatus.LIVE) {
    return { error: "Start the session before publishing captions." };
  }

  const now = new Date();
  try {
    await publishTranslatedCaption(session, {
      speakerId: null,
      originalText: captionText.trim(),
      language: session.sourceLanguage as SupportedLanguage,
      startedAt: now,
      endedAt: now,
      isTyped: true,
      instrumentation: { source: "typed-facilitator" },
    });
  } catch (error) {
    // publishTranslatedCaption's own translation fan-out can take up to ~16s —
    // long enough for the facilitator (or a co-facilitator) to click "End session"
    // while this is in flight, which makes its own re-check throw ("session is not
    // live"). Unlike its other two callers (the caption WS route, caption-agent.ts —
    // plain async functions whose own `.catch(console.error)` absorbs this fine),
    // this is a `useActionState`-bound server action: an uncaught throw here
    // doesn't become `state.error` the way returning one does — it propagates to
    // the nearest error boundary (src/app/sessions/[sessionId]/error.tsx), which
    // replaces the ENTIRE session route (live video, chat, everything) with a
    // generic error screen, exactly what this FormActionResult pattern exists to
    // avoid (see sendChatMessage's identical re-check, which returns instead of
    // throwing, for the sibling case this was missing here).
    console.error("publishCaption failed", error);
    return { error: "This session ended while your caption was being translated. It was not published." };
  }
  return { error: null };
}

/**
 * Marks a BLOCKER (or any) insight resolved so it stops showing under "Act now" —
 * the `Insight.status` column and the `DashboardUpdateEvent.status` union
 * ("ACTIVE"|"RESOLVED"|"SUPERSEDED", session-contracts.ts) already anticipated this;
 * nothing ever actually set it to anything but its "ACTIVE" default, so a resolved
 * blocker had no way to stop being shown, indistinguishable from one raised seconds
 * ago for the rest of the session.
 */
export async function resolveInsight(sessionId: string, insightId: string) {
  if (!(await hasFacilitatorAccess(sessionId))) redirect("/setup");

  // Scoped by both ids together — an insight id alone isn't enough to prove it
  // belongs to *this* session, and `updateMany` silently no-ops (rather than
  // throwing) if the pair doesn't match, so a mismatched id just does nothing.
  await prisma.insight.updateMany({
    where: { id: insightId, sessionId },
    data: { status: "RESOLVED" },
  });
  revalidatePath(`/sessions/${sessionId}/facilitator`);
}

/** Invalidates the learner invite link immediately — a leaked or no-longer-needed link stops working right away, rather than waiting out its expiry. */
export async function revokeLearnerInvite(sessionId: string) {
  if (!(await hasFacilitatorAccess(sessionId))) redirect("/setup");

  await prisma.joinLink.updateMany({
    where: { sessionId, role: ParticipantRole.LEARNER, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  revalidatePath(`/sessions/${sessionId}/facilitator`);
}

/** Ends this browser's facilitator access early: clears the cookie and revokes the underlying join link, so a stolen/leftover cookie can't be reused. */
export async function logoutFacilitator(sessionId: string) {
  if (!(await hasFacilitatorAccess(sessionId))) redirect("/setup");

  const cookieStore = await cookies();
  const token = cookieStore.get(facilitatorCookieName(sessionId))?.value;
  if (token) {
    await prisma.joinLink.updateMany({
      where: { sessionId, role: ParticipantRole.FACILITATOR, tokenHash: hashToken(token) },
      data: { revokedAt: new Date() },
    });
  }
  cookieStore.delete(facilitatorCookieName(sessionId));
  redirect("/setup");
}
