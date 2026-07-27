"use client";

import { getDictionary } from "@/lib/i18n";
import type { SupportedLanguage } from "@/lib/session-contracts";
import type { Confidence } from "@/lib/types";
import { DEFAULT_SIGNAL, WEIGHTS, type RootCause } from "@/lib/confidence";

const TICK_COLOR: Record<Confidence, string> = {
  high: "var(--tick-high)",
  medium: "var(--tick-medium)",
  low: "var(--tick-low)",
};

/** Symbol shown in place of the level's text label — kept to one glyph per level so the
 * badge reads as a compact status dot rather than another line of text in an already
 * dense transcript row. The level name itself isn't lost: it's still read out via the
 * `aria-label` below and spelled out inline once the breakdown is expanded. */
const LEVEL_SYMBOL: Record<Confidence, string> = {
  high: "●",
  medium: "▲",
  low: "■",
};

/**
 * Recipient-facing Confidence Score (issue #130): a symbol + level, expandable
 * (via native `<details>`, so it works on touch/keyboard, not just hover) into a
 * full per-signal breakdown plus the root-cause reason. A bare "Low confidence" is
 * explicitly called out as insufficient in the issue — this always resolves a
 * concrete reason string from `rootCause`, falling back to a generic "some content
 * may not have translated correctly" only when the level is Medium with no single
 * root cause (see computeOverallConfidence's doc comment for when that happens).
 *
 * Only three signals feed the score at all now (audio quality, translation, network —
 * see confidence.ts's own doc comment on why speech recognition/terminology were
 * dropped), each weighted equally, and every one of them is always listed here so the
 * displayed numbers visibly average to `score` instead of reading as unrelated to it.
 * Audio quality has no real measurement source yet, so it always shows the same
 * assumed value (`DEFAULT_SIGNAL`) computeOverallConfidence actually weighted it
 * with — marked "not measured" for a spoken caption, or "Typed" for one with no audio
 * at all (isTyped), so neither case is mistaken for a confirmed "no problem" reading.
 */
export function ConfidenceBadge({
  score,
  level,
  rootCause,
  uiLang,
  isTyped,
  translationScore,
  networkScore,
}: {
  score: number;
  level: Confidence;
  rootCause?: RootCause | null;
  uiLang: SupportedLanguage;
  /** True for the facilitator's/learner's typed-caption composer — there's no audio at
   * all for a typed caption, so its "Audio quality" row reads "Typed" rather than a
   * percentage (there's nothing to have measured, unlike a spoken caption with no
   * report yet). */
  isTyped?: boolean;
  /** 0-100 translation-signal score (Translation.translationConfidence) — always measured. */
  translationScore?: number | null;
  /** 0-100 network-signal score (TranscriptSegment.networkQuality), derived from the
   * speaker's live LiveKit connection quality — null for typed captions and any live
   * capture with no quality report received yet. */
  networkScore?: number | null;
}) {
  const dict = getDictionary(uiLang).common;
  const color = TICK_COLOR[level];
  const levelLabel =
    level === "high" ? dict.confidenceLevelHigh : level === "medium" ? dict.confidenceLevelMedium : dict.confidenceLevelLow;
  const reason = reasonText(dict, rootCause, level);
  const breakdownRows: Array<{ label: string; weight: number; value: number | "typed"; measured: boolean }> = [
    {
      label: dict.confidenceBreakdownAudio,
      weight: WEIGHTS.audioQuality,
      value: isTyped ? "typed" : DEFAULT_SIGNAL,
      measured: false,
    },
    {
      label: dict.confidenceBreakdownTranslation,
      weight: WEIGHTS.translation,
      value: translationScore ?? DEFAULT_SIGNAL,
      measured: translationScore != null,
    },
    {
      label: dict.confidenceBreakdownNetwork,
      weight: WEIGHTS.network,
      value: networkScore ?? DEFAULT_SIGNAL,
      measured: networkScore != null,
    },
  ];

  return (
    <details className="inline-block align-middle">
      <summary
        className="font-data inline-flex cursor-pointer list-none items-center gap-1 px-2 py-1 text-xs"
        style={{ color }}
        aria-label={level === "high" ? levelLabel : `${levelLabel} · ${dict.confidenceScoreLabel(score)}`}
      >
        <span aria-hidden="true">{LEVEL_SYMBOL[level]}</span>
      </summary>
      <div className="mt-1 max-w-xs text-xs font-normal normal-case text-muted-foreground">
        <p className="font-medium" style={{ color }}>
          {levelLabel} · {dict.confidenceScoreLabel(score)}
        </p>
        <dl className="mt-1 flex flex-col gap-0.5">
          {breakdownRows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-3">
              <dt>
                {row.label} <span className="opacity-70">({Math.round(row.weight * 100)}%)</span>
              </dt>
              <dd className="font-data tabular-nums">
                {row.value === "typed" ? (
                  dict.confidenceTyped
                ) : (
                  <>
                    {row.value}%{!row.measured && <span className="opacity-70"> · {dict.confidenceNotMeasured}</span>}
                  </>
                )}
              </dd>
            </div>
          ))}
        </dl>
        {level !== "high" && <p className="mt-1.5">{reason}</p>}
      </div>
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
    case "translation":
      return dict.confidenceReasonTranslation;
    case "network":
      return dict.confidenceReasonNetwork;
    default:
      return level === "high" ? "" : dict.confidenceReasonGeneric;
  }
}
