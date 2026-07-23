"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { hasFacilitatorAccess, learnerParticipantId } from "@/lib/session-access";
import type { SupportedLanguage } from "@/lib/session-contracts";
import { translateText } from "@/lib/translation";

type ChatRole = "facilitator" | "learner";

export async function sendChatMessage(sessionId: string, role: ChatRole, formData: FormData) {
  const text = formData.get("message");
  if (typeof text !== "string" || !text.trim() || text.trim().length > 1_000) {
    throw new Error("Enter a message of up to 1,000 characters.");
  }

  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) redirect("/setup");

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

  const targetLanguages = [...new Set([session.sourceLanguage, ...session.learnerLanguages])] as SupportedLanguage[];
  const translations = await Promise.all(
    targetLanguages.map(async (targetLanguage) => {
      const result = await translateText(text.trim(), sourceLanguage, targetLanguage);
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
      kind: "CHAT",
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
