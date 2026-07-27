"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { learnerParticipantId } from "@/lib/session-access";
import { publishTranslatedCaption } from "@/lib/captions";
import { SessionStatus } from "@/generated/prisma/client";
import type { FormActionResult, SupportedLanguage } from "@/lib/session-contracts";
import { isSupportedLanguage } from "@/lib/i18n";

export async function updateLearnerLanguage(sessionId: string, lang: SupportedLanguage) {
  const participantId = await learnerParticipantId(sessionId);
  // Not `redirect("/setup")` — that's a facilitator-only "create a new workshop" form
  // with nothing productive for a learner to click. A missing/expired learner cookie
  // here is the same ordinary situation the learner PAGES already handle this way (see
  // learn/page.tsx and learn/room/page.tsx's own doc comments) — this action was the
  // one place on the learner side still sending them to that dead end instead.
  if (!participantId) notFound();
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
export async function publishLearnerCaption(
  sessionId: string,
  _prevState: FormActionResult,
  formData: FormData,
): Promise<FormActionResult> {
  const participantId = await learnerParticipantId(sessionId);
  // Not `redirect("/setup")` — see updateLearnerLanguage's matching comment above and
  // the learner pages' own notFound() pattern (learn/page.tsx, learn/room/page.tsx).
  if (!participantId) notFound();

  const captionText = formData.get("captionText");
  if (typeof captionText !== "string" || !captionText.trim() || captionText.trim().length > 3_000) {
    return { error: "Enter a caption of up to 3,000 characters." };
  }

  const participant = await prisma.sessionParticipant.findUnique({
    where: { id: participantId },
    include: { session: true, user: true },
  });
  if (!participant || participant.sessionId !== sessionId) notFound();
  if (participant.session.status !== SessionStatus.LIVE) {
    return { error: "The session must be live before publishing captions." };
  }

  const now = new Date();
  try {
    await publishTranslatedCaption(participant.session, {
      speakerId: participant.user.displayName,
      originalText: captionText.trim(),
      language: participant.preferredLanguage as SupportedLanguage,
      startedAt: now,
      endedAt: now,
      isTyped: true,
      instrumentation: { source: "typed-learner" },
    });
  } catch (error) {
    // Mirrors facilitator/actions.ts's publishCaption: publishTranslatedCaption's own
    // translation fan-out can take up to ~16s — long enough for the facilitator to
    // click "End session" while this is in flight, which makes its own re-check throw.
    // Left uncaught, that propagated out of this useActionState-bound action, past
    // the entire session route's error boundary, replacing the live video/chat with a
    // generic error screen for what's just a mistimed submission.
    console.error("publishLearnerCaption failed", error);
    return { error: "This session ended while your caption was being translated. It was not published." };
  }
  return { error: null };
}
