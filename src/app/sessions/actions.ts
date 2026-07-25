"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SessionStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { hasFacilitatorAccess, learnerParticipantId } from "@/lib/session-access";
import { SUPPORTED_LANGUAGES, type FormActionResult, type SupportedLanguage } from "@/lib/session-contracts";
import { translateText } from "@/lib/providers/translation";
import { isRateLimited } from "@/lib/rate-limit";

type ChatRole = "facilitator" | "learner";

/** 10 messages per 10s per sender — comfortably above real typing/sending speed, but
 * bounds a script that bypasses the UI and POSTs directly to this action from fanning
 * out unlimited paid per-language Claude/local-inference translation calls. */
const CHAT_RATE_LIMIT = { max: 10, windowMs: 10_000 };

export async function sendChatMessage(
  sessionId: string,
  role: ChatRole,
  _prevState: FormActionResult,
  formData: FormData,
): Promise<FormActionResult> {
  const text = formData.get("message");
  if (typeof text !== "string" || !text.trim() || text.trim().length > 1_000) {
    return { error: "Enter a message of up to 1,000 characters." };
  }
  const kind = formData.get("kind") === "QUESTION" ? "QUESTION" : "CHAT";
  const isAnonymous = role === "learner" && formData.get("isAnonymous") === "true";

  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) redirect("/setup");
  if (session.status !== SessionStatus.LIVE) {
    return { error: "This session is not live — messages can only be sent while it is in progress." };
  }

  let senderId: string;
  let sourceLanguage: SupportedLanguage;
  if (role === "facilitator") {
    if (!(await hasFacilitatorAccess(sessionId))) redirect("/setup");
    senderId = session.facilitatorId;
    sourceLanguage = session.sourceLanguage as SupportedLanguage;
  } else {
    const participantId = await learnerParticipantId(sessionId);
    if (!participantId) redirect("/setup");
    const participant = await prisma.sessionParticipant.findUnique({ where: { id: participantId } });
    if (!participant || participant.sessionId !== sessionId) redirect("/setup");
    senderId = participant.userId;
    sourceLanguage = participant.preferredLanguage as SupportedLanguage;
  }

  // Keyed by the real, already-authenticated sender identity (not a raw cookie or IP),
  // so it throttles a single script hammering this action as one specific
  // facilitator/learner rather than needing to guess a request-level identity.
  if (isRateLimited(`chat:${senderId}`, CHAT_RATE_LIMIT.max, CHAT_RATE_LIMIT.windowMs)) {
    return { error: "You're sending messages too quickly. Please wait a moment and try again." };
  }

  const allowCloudFallback = session.translationMode !== "LOCAL_ONLY";
  const targetLanguages = SUPPORTED_LANGUAGES.map((language) => language.value);
  const translations = await Promise.all(
    targetLanguages.map(async (targetLanguage) => {
      const result = await translateText(text.trim(), sourceLanguage, targetLanguage, { allowCloudFallback });
      return result
        ? {
            targetLanguage,
            text: result.text,
            provider: result.provider,
            qualitySignal: result.qualitySignal,
          }
        : null;
    }),
  );

  // Re-check LIVE status right before persisting, not just at the top of this
  // function — the per-language translation loop above can take up to ~10s (local-
  // inference tried first, Claude as fallback), long enough for the facilitator to
  // click "End session" while a learner's message is still in flight. Without this,
  // the message would still get written into a session that had already ended by
  // the time this runs.
  const stillLive = await prisma.session.findUnique({ where: { id: sessionId }, select: { status: true } });
  if (!stillLive || stillLive.status !== SessionStatus.LIVE) {
    return { error: "This session is not live — messages can only be sent while it is in progress." };
  }

  await prisma.message.create({
    data: {
      sessionId,
      senderId,
      originalText: text.trim(),
      language: sourceLanguage,
      kind,
      isAnonymous,
      translations: {
        create: translations.filter(
          (translation): translation is NonNullable<typeof translation> => translation !== null,
        ),
      },
    },
  });

  revalidatePath(`/sessions/${sessionId}/facilitator`);
  revalidatePath(`/sessions/${sessionId}/learn`);
  return { error: null };
}
