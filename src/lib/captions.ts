import { revalidatePath } from "next/cache";
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
  input: {
    speakerId: string | null;
    originalText: string;
    language: SupportedLanguage;
    startedAt: Date;
    endedAt: Date;
    isTyped?: boolean;
  },
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
      isTyped: input.isTyped ?? false,
      translations: {
        create: translations.filter(
          (translation): translation is NonNullable<typeof translation> => translation !== null,
        ),
      },
    },
  });

  safeRevalidatePath(`/sessions/${session.id}/facilitator`);
  safeRevalidatePath(`/sessions/${session.id}/learn`);
  await roomProvider.notifyCaptionsChanged(session.id);

  if (insightProvider.isConfigured) {
    // Fire-and-forget: unlike a Vercel Function, this process stays alive
    // after the response is sent, so there's no need for a `waitUntil`-style
    // hook to keep it running — a plain unawaited call is enough.
    void generateSessionInsights(session).catch((error) => {
      console.error("generateSessionInsights failed", error);
    });
  }
}

/**
 * `revalidatePath` requires an active Next.js request/Server Action async
 * context, which two of this function's three callers don't have: the
 * caption-streaming WebSocket upgrade handler and the LiveKit Agents job
 * process (see server.ts) both run outside `handle(req, res)` entirely, so
 * `revalidatePath` throws "Invariant: static generation store missing" —
 * aborting notifyCaptionsChanged and insight generation below it, every
 * single time a caption is published from either path.
 * `roomProvider.notifyCaptionsChanged` (which `CaptionChannelRefresher`
 * listens for) is the load-bearing live-update signal; `SessionAutoRefresh`
 * also re-polls independently. This cache invalidation is a nice-to-have
 * for the Server Action call site, not something the other two paths can
 * afford to crash on.
 */
function safeRevalidatePath(path: string) {
  try {
    revalidatePath(path);
  } catch {
    // See doc comment above: not every caller has a request context to revalidate against.
  }
}
