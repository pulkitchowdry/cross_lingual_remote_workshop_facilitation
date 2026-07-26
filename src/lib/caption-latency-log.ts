import { performance } from "node:perf_hooks";

type CaptionSource = "browser-ws" | "caption-agent" | "typed-facilitator" | "typed-learner";

interface CaptionLatencyInput {
  sessionId: string;
  segmentId: string;
  source: CaptionSource;
  sourceLanguage: string;
  requestedTargetLanguages: string[];
  translatedTargetLanguages: string[];
  missingTargetLanguages: string[];
  translationProviders: string[];
  audioSubmittedAtMs?: number;
  originalCaptionReadyAtMs: number;
  translationsCompleteAtMs: number;
  persistedAtMs: number;
}

export interface CaptionInstrumentationContext {
  source: CaptionSource;
  audioSubmittedAtMs?: number;
  originalCaptionReadyAtMs?: number;
}

/**
 * Development-only timing for manual caption-quality tests. Opt-in with
 * CAPTION_LATENCY_LOGS=1; never logs audio bytes or caption text.
 */
export function isCaptionLatencyLogEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== "production" && env.CAPTION_LATENCY_LOGS === "1";
}

export function captionLatencyNowMs(): number {
  return performance.now();
}

export function logCaptionLatency(input: CaptionLatencyInput): void {
  if (!isCaptionLatencyLogEnabled()) return;

  const speechToOriginalMs =
    input.audioSubmittedAtMs === undefined ? null : Math.round(input.originalCaptionReadyAtMs - input.audioSubmittedAtMs);
  const originalToTranslatedMs = Math.round(input.translationsCompleteAtMs - input.originalCaptionReadyAtMs);
  const originalToPersistedMs = Math.round(input.persistedAtMs - input.originalCaptionReadyAtMs);

  console.log("[caption-latency]", {
    sessionId: input.sessionId,
    segmentId: input.segmentId,
    source: input.source,
    sourceLanguage: input.sourceLanguage,
    requestedTargetLanguages: input.requestedTargetLanguages,
    translatedTargetLanguages: input.translatedTargetLanguages,
    missingTargetLanguages: input.missingTargetLanguages,
    translationProviders: input.translationProviders,
    speechToOriginalMs,
    originalToTranslatedMs,
    originalToPersistedMs,
  });
}
