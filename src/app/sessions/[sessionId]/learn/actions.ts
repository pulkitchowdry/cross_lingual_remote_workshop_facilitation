"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { learnerParticipantId } from "@/lib/session-access";
import { publishTranslatedCaption } from "@/lib/captions";
import { SessionStatus } from "@/generated/prisma/client";
import type { SupportedLanguage } from "@/lib/session-contracts";
import { isSupportedLanguage } from "@/lib/i18n";

export async function updateLearnerLanguage(sessionId: string, lang: SupportedLanguage) {
  const participantId = await learnerParticipantId(sessionId);
  if (!participantId) redirect("/setup");
  if (!isSupportedLanguage(lang)) return;

  const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { learnerLanguages: true } });
  if (!session?.learnerLanguages.includes(lang)) return;

  await prisma.sessionParticipant.update({ where: { id: participantId }, data: { preferredLanguage: lang } });
  revalidatePath(`/sessions/${sessionId}/learn`);
}

/**
 * Lets a learner type a caption that's read aloud to everyone — the same
 * `isTyped` auto-play path as the facilitator's typed captions (see
 * `TranslatedAudioPlayer`), so a learner who can't speak still has a voice
 * in the room. Recorded as a transcript segment (not a chat message) so it
 * shows up in the Captions tab and gets translated/synthesized the same way.
 */
export async function publishLearnerCaption(sessionId: string, formData: FormData) {
  const participantId = await learnerParticipantId(sessionId);
  if (!participantId) redirect("/setup");

  const captionText = formData.get("captionText");
  if (typeof captionText !== "string" || !captionText.trim() || captionText.trim().length > 3_000) {
    throw new Error("Enter a caption of up to 3,000 characters.");
  }

  const participant = await prisma.sessionParticipant.findUnique({
    where: { id: participantId },
    include: { session: true, user: true },
  });
  if (!participant || participant.sessionId !== sessionId) redirect("/setup");
  if (participant.session.status !== SessionStatus.LIVE) {
    throw new Error("The session must be live before publishing captions.");
  }

  const now = new Date();
  await publishTranslatedCaption(participant.session, {
    speakerId: participant.user.displayName,
    originalText: captionText.trim(),
    language: participant.preferredLanguage as SupportedLanguage,
    startedAt: now,
    endedAt: now,
    isTyped: true,
  });
}
