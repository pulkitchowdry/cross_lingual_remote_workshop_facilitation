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
 * The breakdown only lists signals this app actually measures: translation (always),
 * speech recognition (when the source segment reported one), and network (when the
 * speaker's LiveKit connection quality was reported — see estimateNetworkConfidence).
 * Terminology is deliberately left out: it only reflects unresolved glossary terms,
 * which almost no real caption uses, so it read as a permanently-pinned, uninformative
 * 100% rather than a useful signal. Audio quality isn't shown either — nothing in this
 * app measures microphone/input-audio quality yet, and a fake, unmeasured 100% would
 * misrepresent that as a confirmed "no problem" reading. `reasonText` below matches this:
 * `computeOverallConfidence` never selects `"terminology"` as `rootCause` either (see its
 * doc comment), so there's no reason string that would reference a row this breakdown
 * doesn't show.
 */
export function ConfidenceBadge({
  score,
  level,
  rootCause,
  uiLang,
  translationScore,
  networkScore,
  speechRecognitionScore,
}: {
  score: number;
  level: Confidence;
  rootCause?: RootCause | null;
  uiLang: SupportedLanguage;
  /** 0-100 translation-signal score (Translation.translationConfidence) — always measured. */
  translationScore?: number | null;
  /** 0-100 network-signal score (TranscriptSegment.networkQuality), derived from the
   * speaker's live LiveKit connection quality — null for typed captions and any live
   * capture with no quality report yet, in which case this row is omitted. */
  networkScore?: number | null;
  /** 0-100 STT confidence (TranscriptSegment.sttConfidence) — null for typed captions and
   * STT tiers that don't report one, in which case this row is omitted from the breakdown. */
  speechRecognitionScore?: number | null;
}) {
  const dict = getDictionary(uiLang).common;
  const color = TICK_COLOR[level];
  const levelLabel =
    level === "high" ? dict.confidenceLevelHigh : level === "medium" ? dict.confidenceLevelMedium : dict.confidenceLevelLow;
  const reason = reasonText(dict, rootCause, level);
  const breakdownRows: Array<[string, number]> = [
    [dict.confidenceBreakdownOverall, score],
    ...(translationScore != null ? ([[dict.confidenceBreakdownTranslation, translationScore]] as Array<[string, number]>) : []),
    ...(speechRecognitionScore != null
      ? ([[dict.confidenceBreakdownSpeechRecognition, speechRecognitionScore]] as Array<[string, number]>)
      : []),
    ...(networkScore != null ? ([[dict.confidenceBreakdownNetwork, networkScore]] as Array<[string, number]>) : []),
  ];

  return (
    <details className="inline-block animate-scale-in align-middle">
      <summary
        className="font-data inline-flex cursor-pointer list-none items-center gap-1 px-2 py-1 text-xs"
        style={{ color }}
        aria-label={level === "high" ? levelLabel : `${levelLabel} · ${dict.confidenceScoreLabel(score)}`}
      >
        <span aria-hidden="true">{LEVEL_SYMBOL[level]}</span>
      </summary>
      <div className="mt-1 max-w-xs text-xs font-normal normal-case text-muted-foreground">
        <p className="font-medium" style={{ color }}>
          {levelLabel}
        </p>
        <dl className="mt-1 flex flex-col gap-0.5">
          {breakdownRows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-3">
              <dt>{label}</dt>
              <dd className="font-data tabular-nums">{value}%</dd>
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
    case "speech-recognition":
      return dict.confidenceReasonSpeechRecognition;
    case "translation":
      return dict.confidenceReasonTranslation;
    case "network":
      return dict.confidenceReasonNetwork;
    default:
      return level === "high" ? "" : dict.confidenceReasonGeneric;
  }
}
