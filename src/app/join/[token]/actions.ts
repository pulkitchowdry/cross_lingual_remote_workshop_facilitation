"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ParticipantRole, SessionStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { learnerCookieName, hashToken, createOpaqueToken } from "@/lib/session-security";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/lib/session-contracts";
import { isSessionRetentionExpired } from "@/lib/session-retention";
import { isRateLimited } from "@/lib/rate-limit";

const languageValues = new Set<string>(SUPPORTED_LANGUAGES.map((language) => language.value));

/** 5 join attempts per minute per IP — generous for a real learner (who joins once)
 * or a facilitator testing the flow, but bounds a scripted loop hitting the publicly
 * shared learner invite link (a QR code/copyable link meant for a whole room) to mint
 * unlimited learner identities. */
const JOIN_RATE_LIMIT = { max: 5, windowMs: 60_000 };

export async function joinSession(formData: FormData) {
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (isRateLimited(`join:${ip}`, JOIN_RATE_LIMIT.max, JOIN_RATE_LIMIT.windowMs)) {
    throw new Error("Too many join attempts. Please wait a moment and try again.");
  }

  const token = formData.get("token");
  const displayName = formData.get("displayName");
  const preferredLanguage = formData.get("preferredLanguage");

  if (typeof token !== "string" || typeof displayName !== "string" || typeof preferredLanguage !== "string") {
    throw new Error("Your session details are incomplete.");
  }
  if (!displayName.trim() || displayName.trim().length > 80 || !languageValues.has(preferredLanguage)) {
    throw new Error("Enter a name and supported preferred language.");
  }
  if (formData.get("consent") !== "on") {
    throw new Error("Consent is required before joining a live session.");
  }

  const joinLink = await prisma.joinLink.findUnique({ where: { tokenHash: hashToken(token) } });
  if (
    !joinLink ||
    joinLink.role !== ParticipantRole.LEARNER ||
    joinLink.revokedAt ||
    (joinLink.expiresAt && joinLink.expiresAt < new Date()) ||
    (joinLink.maxUses !== null && joinLink.useCount >= joinLink.maxUses)
  ) {
    throw new Error("This learner invitation is no longer available.");
  }

  const session = await prisma.session.findUnique({ where: { id: joinLink.sessionId } });
  // The join link's own expiry (checked above) is a much longer, independent window
  // (30 days by default) than the session's own retention deadline — a learner could
  // otherwise complete consent and join a session whose data-retention deadline has
  // already passed but hasn't been physically purged yet (the cleanup cron runs
  // hourly at most), immediately hitting a broken "session not found" on the very
  // next page instead of a clear "this invitation is no longer available" here.
  //
  // `status === ENDED` is checked separately from retention: a facilitator ending a
  // session never revokes its (separately-optional) learner invite link, so a leaked
  // or bookmarked link would otherwise keep admitting brand-new learners into an
  // already-concluded workshop for the rest of its (up to 30-day) retention window —
  // landing them on a read-only historical transcript/chat archive they were never
  // part of. DRAFT sessions are intentionally still joinable (learners pre-join and
  // see "Waiting for the facilitator to start" — see learn/page.tsx).
  if (!session || session.status === SessionStatus.ENDED || isSessionRetentionExpired(session)) {
    throw new Error("This session is no longer available.");
  }

  // The learner's ongoing session credential must be a random secret only they
  // ever hold, not `participant.id` — that id is also this participant's
  // LiveKit room identity (see room.ts), which every other participant in the
  // room can read, so using it as the session cookie too would let any
  // co-learner impersonate any other by copying that publicly-visible id.
  const accessToken = createOpaqueToken();

  await prisma.$transaction(async (transaction) => {
    const user = await transaction.user.create({
      data: {
        displayName: displayName.trim(),
        preferredLanguage: preferredLanguage as SupportedLanguage,
      },
    });
    const createdParticipant = await transaction.sessionParticipant.create({
      data: {
        sessionId: joinLink.sessionId,
        userId: user.id,
        role: ParticipantRole.LEARNER,
        preferredLanguage: preferredLanguage as SupportedLanguage,
        consentedAt: new Date(),
        accessTokenHash: hashToken(accessToken),
      },
    });
    await transaction.joinLink.update({
      where: { id: joinLink.id },
      data: { useCount: { increment: 1 } },
    });
    return createdParticipant;
  });

  const cookieStore = await cookies();
  cookieStore.set(learnerCookieName(joinLink.sessionId), accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24,
  });

  redirect(`/sessions/${joinLink.sessionId}/learn`);
}
