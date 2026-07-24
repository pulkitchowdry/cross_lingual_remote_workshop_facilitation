import { revalidatePath } from "next/cache";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/db";
import { translateText } from "@/lib/providers/translation";
import { roomProvider } from "@/lib/providers/room";
import { generateSessionInsights } from "@/lib/insights";
import { insightProvider } from "@/lib/providers/insight";
import type { Session } from "@/generated/prisma/client";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/lib/session-contracts";

/**
 * Translates `originalText` into every learner language, persists it as a
 * transcript segment, and pushes a DataChannel signal so connected viewers
 * refresh immediately. Shared by the facilitator server actions (typed
 * captions) and the live-caption WebSocket route (streamed mic captions) so
 * both paths stay identical.
 */
export async function publishTranslatedCaption(
  session: Session,
  input: { speakerId: string | null; originalText: string; language: SupportedLanguage; startedAt: Date; endedAt: Date },
) {
  const allowCloudFallback = session.translationMode !== "LOCAL_ONLY";
  const translations = await Promise.all(
    SUPPORTED_LANGUAGES.map(async ({ value: target }) => {
      const result = await translateText(input.originalText, input.language, target, { allowCloudFallback });
      return result
        ? {
            targetLanguage: target,
            text: result.text,
            provider: result.provider,
            qualitySignal: result.qualitySignal,
          }
        : null;
    }),
  );

  await prisma.transcriptSegment.create({
    data: {
      sessionId: session.id,
      speakerId: input.speakerId,
      originalText: input.originalText,
      language: input.language,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      translations: {
        create: translations.filter(
          (translation): translation is NonNullable<typeof translation> => translation !== null,
        ),
      },
    },
  });

  revalidatePath(`/sessions/${session.id}/facilitator`);
  revalidatePath(`/sessions/${session.id}/learn`);
  await roomProvider.notifyCaptionsChanged(session.id);

  if (insightProvider.isConfigured) {
    waitUntil(generateSessionInsights(session));
  }
}
