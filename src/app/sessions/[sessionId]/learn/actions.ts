"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { learnerParticipantId } from "@/lib/session-access";
import { translateText } from "@/lib/translation";
import type { SupportedLanguage } from "@/lib/session-contracts";

export async function askFacilitator(sessionId: string, formData: FormData) {
  const participantId = await learnerParticipantId(sessionId);
  if (!participantId) redirect("/setup");

  const question = formData.get("question");
  if (typeof question !== "string" || !question.trim() || question.trim().length > 1_000) {
    throw new Error("Enter a question of up to 1,000 characters.");
  }

  const participant = await prisma.sessionParticipant.findFirst({
    where: { id: participantId, sessionId },
    include: { session: true },
  });
  if (!participant) redirect("/setup");

  const sourceLanguage = participant.preferredLanguage as SupportedLanguage;
  const targetLanguage = participant.session.sourceLanguage as SupportedLanguage;
  const translation = await translateText(question.trim(), sourceLanguage, targetLanguage);

  await prisma.message.create({
    data: {
      sessionId,
      senderId: participant.userId,
      originalText: question.trim(),
      language: sourceLanguage,
      kind: "QUESTION",
      translations: translation
        ? {
            create: {
              targetLanguage,
              text: translation.text,
              provider: translation.provider,
              qualitySignal: translation.qualitySignal,
            },
          }
        : undefined,
    },
  });

  revalidatePath(`/sessions/${sessionId}/facilitator`);
  revalidatePath(`/sessions/${sessionId}/learn`);
}
