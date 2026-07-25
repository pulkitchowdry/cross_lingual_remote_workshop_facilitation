"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ParticipantRole, SessionStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { hasFacilitatorAccess } from "@/lib/session-access";
import { publishTranslatedCaption } from "@/lib/captions";
import { facilitatorCookieName, hashToken } from "@/lib/session-security";
import type { SupportedLanguage } from "@/lib/session-contracts";
import { isSupportedLanguage } from "@/lib/i18n";

export async function updateFacilitatorLanguage(sessionId: string, lang: SupportedLanguage) {
  if (!(await hasFacilitatorAccess(sessionId))) redirect("/setup");
  if (!isSupportedLanguage(lang)) return;

  await prisma.session.update({ where: { id: sessionId }, data: { sourceLanguage: lang } });
  revalidatePath(`/sessions/${sessionId}/facilitator`);
}

export async function startSession(sessionId: string) {
  if (!(await hasFacilitatorAccess(sessionId))) redirect("/setup");

  await prisma.session.update({
    where: { id: sessionId },
    data: { status: SessionStatus.LIVE, startedAt: new Date() },
  });
  revalidatePath(`/sessions/${sessionId}/facilitator`);
  revalidatePath(`/sessions/${sessionId}/learn`);
}

export async function endSession(sessionId: string) {
  if (!(await hasFacilitatorAccess(sessionId))) redirect("/setup");

  await prisma.session.update({
    where: { id: sessionId },
    data: { status: SessionStatus.ENDED, endedAt: new Date() },
  });
  revalidatePath(`/sessions/${sessionId}/facilitator`);
  revalidatePath(`/sessions/${sessionId}/learn`);
}

export async function publishCaption(sessionId: string, formData: FormData) {
  if (!(await hasFacilitatorAccess(sessionId))) redirect("/setup");

  const captionText = formData.get("captionText");
  if (typeof captionText !== "string" || !captionText.trim() || captionText.trim().length > 3_000) {
    throw new Error("Enter a caption of up to 3,000 characters.");
  }

  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session || session.status !== SessionStatus.LIVE) {
    throw new Error("Start the session before publishing captions.");
  }

  const now = new Date();
  await publishTranslatedCaption(session, {
    speakerId: "Facilitator",
    originalText: captionText.trim(),
    language: session.sourceLanguage as SupportedLanguage,
    startedAt: now,
    endedAt: now,
  });
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
