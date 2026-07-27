import type { Confidence } from "@/lib/types";

/**
 * The individual communication-quality signals that feed a single translated
 * caption's Confidence Score (see GitHub issue #130). Each is 0-100; a signal
 * the caller couldn't measure should be omitted rather than guessed at zero —
 * `computeOverallConfidence` treats a missing signal as "no evidence of a
 * problem" (100), not "definitely fine" vs "definitely broken". Deliberately
 * just these three: speech-recognition and terminology signals used to also
 * feed this, but were dropped as not useful to this product — terminology in
 * particular almost never moved off a pinned 100%, so it added noise, not signal.
 */
export interface ConfidenceSignals {
  /** Reserved for a future audio-input-level signal — no server-side source for this yet. */
  audioQuality?: number;
  /** Derived from the translation provider/tier and any truncation it reported. */
  translation?: number;
  /** Derived from the speaking participant's live LiveKit connection quality — see estimateNetworkConfidence. */
  network?: number;
}

export type RootCause = "audio" | "translation" | "network";

export interface ConfidenceResult {
  /** 0-100 weighted composite, for display ("93%") and analytics averages. */
  overall: number;
  level: Confidence;
  /** The single signal identified as most responsible for a Medium/Low score, if any. */
  rootCause: RootCause | null;
  breakdown: Required<ConfidenceSignals>;
}

/** A signal the caller couldn't measure is scored as this, not zero — see
 * ConfidenceSignals' own doc comment. Exported so the breakdown UI (ConfidenceBadge)
 * can show the exact same assumed value for an unmeasured signal that the overall
 * score was actually computed with, instead of just omitting the row — otherwise the
 * displayed signals' own weighted contributions don't add up to the displayed overall,
 * which reads as the score being wrong rather than as "some inputs aren't shown". */
export const DEFAULT_SIGNAL = 100;

/** Below this, a signal is treated as the message's likely root cause rather than
 * just dragging down the average — matches the issue's worked scenarios (e.g. 48%
 * audio / 55% translation both individually produce a Low score). */
const ROOT_CAUSE_THRESHOLD = 60;

/** Equal weighting — a plain average of the three signals, not a tiered one; none of
 * the three is considered more or less important than the others. Exported so the
 * breakdown UI can show each signal's own share of the overall score. */
export const WEIGHTS: Record<keyof ConfidenceSignals, number> = {
  audioQuality: 1 / 3,
  translation: 1 / 3,
  network: 1 / 3,
};

/**
 * Combines the per-stage confidence signals of one translated caption into a
 * single overall score, level, and (for Low) a root cause — see issue #130's
 * "Confidence Score Logic" scenarios.
 */
export function computeOverallConfidence(signals: ConfidenceSignals): ConfidenceResult {
  const breakdown: Required<ConfidenceSignals> = {
    audioQuality: clamp(signals.audioQuality ?? DEFAULT_SIGNAL),
    translation: clamp(signals.translation ?? DEFAULT_SIGNAL),
    network: clamp(signals.network ?? DEFAULT_SIGNAL),
  };

  const overall = Math.round(
    (Object.keys(WEIGHTS) as Array<keyof ConfidenceSignals>).reduce(
      (sum, key) => sum + breakdown[key] * WEIGHTS[key],
      0,
    ),
  );

  const severeCauses: Array<[RootCause, number]> = [
    ["audio", breakdown.audioQuality],
    ["translation", breakdown.translation],
    ["network", breakdown.network],
  ];
  const severe = severeCauses.find(([, score]) => score < ROOT_CAUSE_THRESHOLD);
  if (severe) {
    return { overall, level: "low", rootCause: severe[0], breakdown };
  }

  if (overall < 85) {
    return { overall, level: "medium", rootCause: null, breakdown };
  }

  return { overall, level: "high", rootCause: null, breakdown };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/** Speaker-facing "why" + suggested next steps for each root cause — issue #130
 * is explicit that a bare "Low confidence" is not acceptable, the message must
 * explain what went wrong and what to do about it. */
export const ROOT_CAUSE_GUIDANCE: Record<RootCause, { reasonKey: "audio" | "translation" | "network" }> = {
  audio: { reasonKey: "audio" },
  translation: { reasonKey: "translation" },
  network: { reasonKey: "network" },
};

/** The reasons a recipient can pick when requesting clarification on a Medium/Low
 * confidence caption (issue #130's "Recipient Action" section) — sent as a QUESTION
 * chat message so the facilitator sees exactly why, not just that something was unclear. */
export const CLARIFICATION_REASONS = [
  "could-not-hear",
  "translation-incorrect",
  "please-repeat",
  "explain-differently",
] as const;
export type ClarificationReason = (typeof CLARIFICATION_REASONS)[number];

/**
 * Derives a per-language translation confidence signal from the provider tier
 * and Claude's own truncation report — neither provider returns a real
 * numeric confidence, so this is a documented heuristic, not a measured value.
 * `claude` (cloud) translations score higher than `nllb` (self-hosted) ones,
 * reflecting the quality gap these tiers are already tiered by (see
 * `docs/TRANSLATION_ARCHITECTURE.md`); a translation Claude reported as
 * truncated at `max_tokens` is scored well below the root-cause threshold
 * since part of the message is simply missing.
 */
export function estimateTranslationConfidence(provider: string, wasTruncated: boolean): number {
  if (wasTruncated) return 40;
  if (provider === "claude") return 96;
  if (provider === "nllb") return 88;
  return DEFAULT_SIGNAL;
}

/** livekit-client's `ConnectionQuality` enum values (a plain string union on the wire —
 * see `@livekit/rtc-node`'s matching enum for the server-side agent path), mapped to a
 * 0-100 score. `"unknown"` (the SDK's own default before the first quality report
 * arrives) deliberately maps to `undefined`, same as no report at all — it isn't
 * evidence of a *good* connection, just the absence of one yet. */
const CONNECTION_QUALITY_SCORE: Record<string, number> = {
  excellent: 100,
  good: 75,
  poor: 35,
  lost: 0,
};

/**
 * The Confidence Score's network signal (issue #130's "Future Enhancements") — derived
 * from the speaking participant's own live LiveKit connection quality at the moment
 * their audio was captured, reported by the client (browser-mic path) or the
 * server-side caption-agent worker (facilitator LiveKit-capture path). `undefined` for
 * `"unknown"`/no report, which `computeOverallConfidence` already treats as "no
 * evidence of a problem" rather than a measured 100.
 */
export function estimateNetworkConfidence(quality: string | null | undefined): number | undefined {
  if (!quality) return undefined;
  return CONNECTION_QUALITY_SCORE[quality];
}
