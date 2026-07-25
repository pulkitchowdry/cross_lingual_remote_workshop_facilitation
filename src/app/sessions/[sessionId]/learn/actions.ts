"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { learnerParticipantId } from "@/lib/session-access";
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
