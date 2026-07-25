"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SessionStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { hasFacilitatorAccess, learnerParticipantId } from "@/lib/session-access";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/lib/session-contracts";
import { translateText } from "@/lib/providers/translation";

type ChatRole = "facilitator" | "learner";

export async function sendChatMessage(sessionId: string, role: ChatRole, formData: FormData) {
  const text = formData.get("message");
  if (typeof text !== "string" || !text.trim() || text.trim().length > 1_000) {
    throw new Error("Enter a message of up to 1,000 characters.");
  }
  const kind = formData.get("kind") === "QUESTION" ? "QUESTION" : "CHAT";
  const isAnonymous = role === "learner" && formData.get("isAnonymous") === "true";

  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) redirect("/setup");
  if (session.status !== SessionStatus.LIVE) {
    throw new Error("This session is not live — messages can only be sent while it is in progress.");
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
}
