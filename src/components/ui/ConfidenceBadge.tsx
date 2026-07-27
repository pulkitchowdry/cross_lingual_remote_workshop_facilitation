"use client";

import { getDictionary } from "@/lib/i18n";
import type { SupportedLanguage } from "@/lib/session-contracts";
import type { Confidence } from "@/lib/types";
import type { RootCause } from "@/lib/confidence";

const TICK_COLOR: Record<Confidence, string> = {
  high: "var(--tick-high)",
  medium: "var(--tick-medium)",
  low: "var(--tick-low)",
};

/**
 * Recipient-facing Confidence Score (issue #130): a percent + level, expandable
 * (via native `<details>`, so it works on touch/keyboard, not just hover) into
 * the specific reason. A bare "Low confidence" is explicitly called out as
 * insufficient in the issue — this always resolves a concrete reason string
 * from `rootCause`, falling back to a generic "some content may not have
 * translated correctly" only when the level is Medium with no single root cause
 * (see computeOverallConfidence's doc comment for when that happens).
 */
export function ConfidenceBadge({
  score,
  level,
  rootCause,
  uiLang,
}: {
  score: number;
  level: Confidence;
  rootCause?: RootCause | null;
  uiLang: SupportedLanguage;
}) {
  const dict = getDictionary(uiLang).common;
  const color = TICK_COLOR[level];
  const levelLabel =
    level === "high" ? dict.confidenceLevelHigh : level === "medium" ? dict.confidenceLevelMedium : dict.confidenceLevelLow;
  const reason = reasonText(dict, rootCause, level);

  if (level === "high") {
    return (
      <span className="font-data inline-flex items-center gap-1 text-[0.6875rem] font-medium uppercase tracking-wider" style={{ color }} title={dict.confidenceScoreLabel(score)}>
        {levelLabel}
      </span>
    );
  }

  return (
    <details className="inline-block align-middle">
      <summary
        className="font-data inline-flex cursor-pointer list-none items-center gap-1 text-[0.6875rem] font-medium uppercase tracking-wider"
        style={{ color }}
      >
        {levelLabel} · {dict.confidenceScoreLabel(score)}
      </summary>
      <p className="mt-1 max-w-xs text-xs font-normal normal-case text-muted-foreground">{reason}</p>
    </details>
  );
}

function reasonText(
  dict: ReturnType<typeof getDictionary>["common"],
  rootCause: RootCause | null | undefined,
  level: Confidence,
): string {
  switch (rootCause) {
    case "audio":
      return dict.confidenceReasonAudio;
    case "speech-recognition":
      return dict.confidenceReasonSpeechRecognition;
    case "translation":
      return dict.confidenceReasonTranslation;
    case "terminology":
      return dict.confidenceReasonTerminology;
    case "network":
      return dict.confidenceReasonNetwork;
    default:
      return level === "high" ? "" : dict.confidenceReasonGeneric;
  }
}
