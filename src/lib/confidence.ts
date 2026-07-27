import type { Confidence } from "@/lib/types";

/**
 * The individual communication-quality signals that feed a single translated
 * caption's Confidence Score (see GitHub issue #130). Each is 0-100; a signal
 * the caller couldn't measure should be omitted rather than guessed at zero —
 * `computeOverallConfidence` treats a missing signal as "no evidence of a
 * problem" (100), not "definitely fine" vs "definitely broken".
 */
export interface ConfidenceSignals {
  /** Deepgram's own alternative-transcript confidence, when the STT tier reports one. */
  speechRecognition?: number;
  /** Derived from the translation provider/tier and any truncation it reported. */
  translation?: number;
  /** Lower when the caption uses glossary terms this session has no approved translation for. */
  terminology?: number;
  /** Reserved for a future client-reported network/connection-quality signal — see issue #130's "Future Enhancements". */
  network?: number;
  /** Reserved for a future audio-input-level signal — no server-side source for this yet. */
  audioQuality?: number;
}

export type RootCause = "audio" | "speech-recognition" | "translation" | "terminology" | "network";

export interface ConfidenceResult {
  /** 0-100 weighted composite, for display ("93%") and analytics averages. */
  overall: number;
  level: Confidence;
  /** The single signal identified as most responsible for a Medium/Low score, if any. */
  rootCause: RootCause | null;
  breakdown: Required<ConfidenceSignals>;
}

const DEFAULT_SIGNAL = 100;

/** Below this, a signal is treated as the message's likely root cause rather than
 * just dragging down the weighted average — matches the issue's worked scenarios
 * (e.g. 48% audio / 55% translation both individually produce a Low score). */
const ROOT_CAUSE_THRESHOLD = 60;

/** Weights for the overall composite score. Translation and audio/speech-recognition
 * carry the most weight since a failure there breaks the whole message; terminology
 * only ever mangles a single term, so it's weighted (and gated, see below) more leniently. */
const WEIGHTS: Record<keyof ConfidenceSignals, number> = {
  audioQuality: 0.2,
  speechRecognition: 0.2,
  translation: 0.3,
  terminology: 0.15,
  network: 0.15,
};

/**
 * Combines the per-stage confidence signals of one translated caption into a
 * single overall score, level, and (for Medium/Low) a root cause — see issue
 * #130's "Confidence Score Logic" scenarios. Root cause is decision-tree based,
 * not just "whichever signal is lowest": a badly-translated technical term
 * should read as Medium ("terminology") rather than Low ("translation"), since
 * it affects one word, not the whole sentence, matching the issue's Scenario 4.
 */
export function computeOverallConfidence(signals: ConfidenceSignals): ConfidenceResult {
  const breakdown: Required<ConfidenceSignals> = {
    audioQuality: clamp(signals.audioQuality ?? DEFAULT_SIGNAL),
    speechRecognition: clamp(signals.speechRecognition ?? DEFAULT_SIGNAL),
    translation: clamp(signals.translation ?? DEFAULT_SIGNAL),
    terminology: clamp(signals.terminology ?? DEFAULT_SIGNAL),
    network: clamp(signals.network ?? DEFAULT_SIGNAL),
  };

  const overall = Math.round(
    (Object.keys(WEIGHTS) as Array<keyof ConfidenceSignals>).reduce(
      (sum, key) => sum + breakdown[key] * WEIGHTS[key],
      0,
    ),
  );

  // Checked in severity order: any one of these below threshold makes the whole
  // message unreliable (Low), before terminology (Medium-only) is even considered.
  const severeCauses: Array<[RootCause, number]> = [
    ["audio", breakdown.audioQuality],
    ["speech-recognition", breakdown.speechRecognition],
    ["translation", breakdown.translation],
    ["network", breakdown.network],
  ];
  const severe = severeCauses.find(([, score]) => score < ROOT_CAUSE_THRESHOLD);
  if (severe) {
    return { overall, level: "low", rootCause: severe[0], breakdown };
  }

  if (breakdown.terminology < ROOT_CAUSE_THRESHOLD) {
    return { overall, level: "medium", rootCause: "terminology", breakdown };
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
export const ROOT_CAUSE_GUIDANCE: Record<RootCause, { reasonKey: "audio" | "speechRecognition" | "translation" | "terminology" | "network" }> = {
  audio: { reasonKey: "audio" },
  "speech-recognition": { reasonKey: "speechRecognition" },
  translation: { reasonKey: "translation" },
  terminology: { reasonKey: "terminology" },
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

interface GlossaryTermLike {
  sourceTerm: string;
  aliases: string[];
  approvedTranslation: string | null;
}

/**
 * Lowers the terminology signal when the source text uses a glossary term this
 * session has no `approvedTranslation` for (issue #130 lists "missing glossary
 * entries" as a terminology-confidence cause). Each unresolved term found costs
 * 25 points, floored at 20 so one very jargon-heavy sentence still reads as Low
 * via the terminology-only path rather than negative.
 */
export function estimateTerminologyConfidence(originalText: string, glossary: GlossaryTermLike[]): number {
  if (glossary.length === 0) return DEFAULT_SIGNAL;
  const haystack = originalText.toLowerCase();
  const unresolvedMatches = glossary.filter((term) => {
    if (term.approvedTranslation) return false;
    const needles = [term.sourceTerm, ...term.aliases];
    return needles.some((needle) => needle.trim().length > 0 && haystack.includes(needle.toLowerCase()));
  }).length;
  if (unresolvedMatches === 0) return DEFAULT_SIGNAL;
  return Math.max(20, DEFAULT_SIGNAL - unresolvedMatches * 25);
}
