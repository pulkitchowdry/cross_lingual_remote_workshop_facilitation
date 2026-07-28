import { prisma } from "@/lib/db";
import { safeRevalidatePath } from "@/lib/safe-revalidate";
import { isHallucinatedCaption } from "@/lib/caption-hallucination";
import { translateText } from "@/lib/providers/translation";
import { roomProvider } from "@/lib/providers/room";
import { generateSessionInsights } from "@/lib/insights";
import { insightProvider } from "@/lib/providers/insight";
import { SessionStatus, type Session } from "@/generated/prisma/client";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/lib/session-contracts";
import {
  captionLatencyNowMs,
  logCaptionLatency,
  type CaptionInstrumentationContext,
} from "@/lib/caption-latency-log";
import {
  computeOverallConfidence,
  estimateCentralGlossaryConfidence,
  estimateNetworkConfidence,
  estimateTerminologyConfidence,
} from "@/lib/confidence";
import { buildGlossaryPromptHint, findGlossaryMatches, type CentralGlossaryEntryLike } from "@/lib/glossary";
import { recordUnknownGlossaryTerms } from "@/lib/glossary-suggestions";

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
    /** 0-100 speech-recognition confidence from the STT tier, when it reported one — see src/lib/confidence.ts. Undefined for typed captions. */
    sttConfidence?: number;
    /** The speaking participant's live LiveKit connection quality at capture time ("excellent" |
     * "good" | "poor" | "lost"), reported by the browser-mic path (LiveCaptionStream.tsx) or the
     * server-side caption-agent worker — mapped to a 0-100 score by estimateNetworkConfidence.
     * Undefined for typed captions and any capture path with no quality report yet. */
    networkQuality?: string;
    instrumentation?: CaptionInstrumentationContext;
  },
) {
  // Every STT tier (Deepgram's streaming path here, local-inference's Whisper tier on
  // its own) hallucinates the same stock filler on silence/background noise — "You" is
  // the most common (see caption-hallucination.ts's doc comment). Both live-caption
  // callers (captions-socket.ts's browser-mic fallback and caption-agent.ts's LiveKit
  // worker) route through this single function, so filtering here — rather than
  // duplicating the check in each — catches it regardless of which one is active.
  // Typed captions are exempt: a facilitator/learner typing "You" is never a
  // hallucination, and text-filtering their deliberate input would be a real bug.
  if (!input.isTyped && isHallucinatedCaption(input.originalText)) return;

  const originalCaptionReadyAtMs = input.instrumentation?.originalCaptionReadyAtMs ?? captionLatencyNowMs();
  const allowCloudFallback = session.translationMode !== "LOCAL_ONLY";
  // Confidence Score's terminology signal (issue #130) needs this session's glossary to
  // check whether the caption uses a term with no approved translation yet — fetched once
  // per segment rather than once per target language, since it's the same for all of them.
  const [glossaryTerms, centralGlossary] = await Promise.all([
    // NOTE: as of this pass, nothing in the app ever creates/updates/deletes a
    // `GlossaryTerm` row (grepped the whole src/app tree — only `CentralGlossaryEntry`,
    // a different table, has a write path, in
    // src/app/sessions/[sessionId]/facilitator/glossary/actions.ts). This query therefore
    // always returns an empty array, and estimateTerminologyConfidence's session-specific-
    // glossary signal below is presently a permanently-dead no-op (always maximally
    // confident) even though the schema and confidence.ts's logic were clearly built to
    // use it. Left as-is rather than inventing a GlossaryTerm CRUD UI/feature here — flagged
    // for a future PR that decides the actual product intent for this table.
    prisma.glossaryTerm.findMany({
      where: { sessionId: session.id },
      select: { sourceTerm: true, aliases: true, approvedTranslation: true },
    }),
    // Centralised Technical Glossary (issue #131) — shared across every session/facilitator,
    // unlike glossaryTerms above. Fetched once per segment (same reasoning as glossaryTerms:
    // it's the same set for every target language) rather than per-language.
    prisma.centralGlossaryEntry.findMany({
      select: { sourceTerm: true, translate: true, translations: true },
    }),
  ]);
  const centralGlossaryEntries: CentralGlossaryEntryLike[] = centralGlossary.map((entry) => ({
    sourceTerm: entry.sourceTerm,
    translate: entry.translate,
    translations: (entry.translations as Record<string, string>) ?? {},
  }));
  const glossaryMatches = findGlossaryMatches(input.originalText, centralGlossaryEntries);
  const terminologyConfidence = estimateTerminologyConfidence(input.originalText, glossaryTerms);
  // Per-segment, not per-target-language — the same connection-quality report applies to
  // every translation of this one caption, same reasoning as sttConfidence above it.
  const networkConfidence = estimateNetworkConfidence(input.networkQuality);
  const translations = await Promise.all(
    SUPPORTED_LANGUAGES.map(async ({ value: target }) => {
      const glossaryHint = buildGlossaryPromptHint(glossaryMatches, target);
      const result = await translateText(input.originalText, input.language, target, {
        allowCloudFallback,
        glossaryHint,
      });
      if (!result) return null;
      const centralGlossaryConfidence = estimateCentralGlossaryConfidence(result.text, glossaryMatches, target);
      const confidence = computeOverallConfidence({
        speechRecognition: input.sttConfidence,
        translation: result.confidence,
        // The lower of the two terminology signals wins — either an unapproved
        // session-specific term or a central-glossary mismatch is enough on its own
        // to make this caption's terminology handling suspect.
        terminology: Math.min(terminologyConfidence, centralGlossaryConfidence),
        network: networkConfidence,
      });
      return {
        targetLanguage: target,
        text: result.text,
        provider: result.provider,
        qualitySignal: result.qualitySignal,
        confidence: confidence.overall,
        confidenceLevel: confidence.level,
        rootCause: confidence.rootCause,
        // Individual signals for the Confidence Score breakdown UI (ConfidenceBadge) — see
        // that column's own schema comment for why audioQuality isn't persisted.
        translationConfidence: confidence.breakdown.translation,
        terminologyConfidence: confidence.breakdown.terminology,
      };
    }),
  );
  const translationsCompleteAtMs = captionLatencyNowMs();
  const requestedTargetLanguages = SUPPORTED_LANGUAGES.map(({ value }) => value).filter((target) => target !== input.language);
  const successfulTranslations = translations.filter(
    (translation): translation is NonNullable<typeof translation> => translation !== null,
  );
  const translatedTargetLanguageSet = new Set(successfulTranslations.map((translation) => translation.targetLanguage));
  const translatedTargetLanguages = successfulTranslations.map((translation) => translation.targetLanguage);
  const missingTargetLanguages = requestedTargetLanguages.filter((target) => !translatedTargetLanguageSet.has(target));

  // Every caller checks LIVE status before starting this function, but the
  // translation batch above can take up to ~16s worst case (each language tries
  // local-inference then retries Claude on a transient failure) — long enough for
  // the facilitator to click "End session" while it's in flight. The WebSocket and
  // caption-agent callers already re-fetch and re-check per segment before calling
  // this function (redundant with this check, which is fine); the facilitator's
  // typed-caption action did not, and could otherwise silently append a caption to
  // an already-ENDED session's transcript.
  const stillLive = await prisma.session.findUnique({ where: { id: session.id }, select: { status: true } });
  if (!stillLive || stillLive.status !== SessionStatus.LIVE) {
    throw new Error("This session is not live — captions can only be published while it is in progress.");
  }

  const segment = await prisma.transcriptSegment.create({
    data: {
      sessionId: session.id,
      speakerId: input.speakerId,
      originalText: input.originalText,
      language: input.language,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      isTyped: input.isTyped ?? false,
      sttConfidence: input.sttConfidence,
      networkQuality: networkConfidence,
      translations: {
        create: successfulTranslations,
      },
    },
  });
  const persistedAtMs = captionLatencyNowMs();
  logCaptionLatency({
    sessionId: session.id,
    segmentId: segment.id,
    source: input.instrumentation?.source ?? (input.isTyped ? "typed-facilitator" : "browser-ws"),
    sourceLanguage: input.language,
    requestedTargetLanguages,
    translatedTargetLanguages,
    missingTargetLanguages,
    translationProviders: Array.from(
      new Set(
        successfulTranslations.map((translation) => translation.provider),
      ),
    ),
    audioSubmittedAtMs: input.instrumentation?.audioSubmittedAtMs,
    originalCaptionReadyAtMs,
    translationsCompleteAtMs,
    persistedAtMs,
  });

  safeRevalidatePath(`/sessions/${session.id}/facilitator`);
  safeRevalidatePath(`/sessions/${session.id}/learn`);
  await roomProvider.notifyCaptionsChanged(session.id);

  // Fire-and-forget, same pattern as generateSessionInsights below — post-meeting
  // glossary recommendations (issue #131) don't need to block caption publishing.
  const knownTerms = new Set([
    ...centralGlossaryEntries.map((entry) => entry.sourceTerm),
    ...glossaryTerms.map((term) => term.sourceTerm),
  ]);
  void recordUnknownGlossaryTerms(session.id, input.originalText, knownTerms).catch((error) => {
    console.error("recordUnknownGlossaryTerms failed", error);
  });

  if (insightProvider.isConfigured) {
    // Fire-and-forget: unlike a Vercel Function, this process stays alive
    // after the response is sent, so there's no need for a `waitUntil`-style
    // hook to keep it running — a plain unawaited call is enough.
    void generateSessionInsights(session).catch((error) => {
      console.error("generateSessionInsights failed", error);
    });
  }
}
