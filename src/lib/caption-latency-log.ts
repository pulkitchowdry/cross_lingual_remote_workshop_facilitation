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
 * Opt-in with CAPTION_LATENCY_LOGS=1; never logs audio bytes or caption text. Originally
 * dev-only, but the payload (translationProviders, missingTargetLanguages, per-stage
 * timing) is exactly the production diagnostic signal that was missing during
 * 2026-07-31's caption incident — every provider call site only logs its own failures,
 * never a success, so this was the one place that could show "this segment succeeded,
 * and here's which provider actually served it" end to end. Now available in production
 * too (still opt-in, so default log volume is unchanged) — flip it on via the
 * CAPTION_LATENCY_LOGS Railway variable during a live incident, no deploy required.
 */
export function isCaptionLatencyLogEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CAPTION_LATENCY_LOGS === "1";
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
