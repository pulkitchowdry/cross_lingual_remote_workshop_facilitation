"use client";

import { useEffect, useRef, useState } from "react";
import { useMeetingShell } from "@/components/meeting/MeetingShellContext";
import { resolveTranslatedText } from "@/lib/translation-view";
import { getDictionary } from "@/lib/i18n";
import { ConfidenceBadge } from "@/components/ui/ConfidenceBadge";
import type { MeetingTranscriptSegment } from "@/components/meeting/types";
import type { SupportedLanguage } from "@/lib/session-contracts";
import type { RootCause } from "@/lib/confidence";

const RECENT_SEGMENT_COUNT = 3;
/** How long a caption stays on screen after it first appears, regardless of whether
 * newer captions arrive — tuned to "a couple sentences' worth of reading time" per
 * user feedback that captions were sitting on screen forever with no expiry at all. */
const CAPTION_DISPLAY_MS = 3_000;
/** How often to re-check for expired captions — fine enough to feel responsive
 * without re-rendering on every animation frame for no reason. */
const EXPIRY_TICK_MS = 500;

/** Pure: which segment ids are still within their display window right now.
 * Shared by both effects below so "recompute on new data" and "recompute on
 * the tick" can't drift into two different notions of "still visible". */
function computeVisibleIds(transcript: MeetingTranscriptSegment[], firstSeenAt: Map<string, number>, now: number): Set<string> {
  const visible = new Set<string>();
  for (const segment of transcript) {
    const firstSeen = firstSeenAt.get(segment.id) ?? now;
    if (now - firstSeen < CAPTION_DISPLAY_MS) visible.add(segment.id);
  }
  return visible;
}

/**
 * Renders on top of the video/screen-share pane instead of the separate below-grid transcript
 * section both pages already have — same data (`transcript` prop threaded down from the page's
 * existing Prisma query), same delivery mechanism (`CaptionChannelRefresher`'s DataChannel signal
 * -> `router.refresh()` -> fresh props), just a different presentation. Does not change
 * `src/lib/captions.ts` or `notifyCaptionsChanged`.
 */
export function CaptionOverlay({ transcript, uiLang }: { transcript: MeetingTranscriptSegment[]; uiLang: SupportedLanguage }) {
  const { captionsVisible, captionMode, captionFontScale, captionPosition, growCaptionFont, shrinkCaptionFont } = useMeetingShell();
  const dict = getDictionary(uiLang).meeting;
  const translationUnavailable = getDictionary(uiLang).common.translationUnavailable;

  // Client-observed "first seen" time per segment id, not the server's `startedAt` —
  // deliberately, so expiry doesn't depend on clock sync or on how stale a segment
  // already was by the time a poll/DataChannel refresh actually delivered it here.
  // A ref (not state) since stamping it must not itself trigger a render — only the
  // derived `visibleIds` state below does that.
  const firstSeenAtRef = useRef<Map<string, number>>(new Map());
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const seen = firstSeenAtRef.current;
    const now = Date.now();
    for (const segment of transcript) {
      if (!seen.has(segment.id)) seen.set(segment.id, now);
    }
    // Prune ids no longer present so a long session's map doesn't grow unbounded —
    // same bookkeeping shape as TranslatedAudioPlayer's own seen-id set.
    const currentIds = new Set(transcript.map((segment) => segment.id));
    for (const id of seen.keys()) {
      if (!currentIds.has(id)) seen.delete(id);
    }
    setVisibleIds(computeVisibleIds(transcript, seen, now));
  }, [transcript]);

  useEffect(() => {
    if (!captionsVisible || transcript.length === 0) return;
    const interval = setInterval(() => {
      setVisibleIds(computeVisibleIds(transcript, firstSeenAtRef.current, Date.now()));
    }, EXPIRY_TICK_MS);
    return () => clearInterval(interval);
  }, [captionsVisible, transcript]);

  if (!captionsVisible || transcript.length === 0) return null;

  const recent = transcript.filter((segment) => visibleIds.has(segment.id)).slice(-RECENT_SEGMENT_COUNT);

  return (
    <div
      className={`pointer-events-none absolute inset-x-0 z-10 flex flex-col items-center gap-1.5 px-6 ${
        captionPosition === "bottom" ? "bottom-4" : "top-4"
      }`}
    >
      <div className="pointer-events-auto flex max-h-40 w-full max-w-2xl flex-col gap-1.5 overflow-y-auto">
        {recent.map((segment) => {
          const resolved = resolveTranslatedText(segment, uiLang);
          const translation = segment.translations.find((item) => item.targetLanguage === uiLang);
          const showConfidence =
            !resolved.isOriginal && translation?.confidence != null && translation.confidenceLevel && translation.confidenceLevel !== "high";
          return (
            <div
              key={segment.id}
              className="rounded-md px-3 py-1.5 text-center shadow-lg"
              style={{ background: "rgba(10, 14, 22, 0.78)", fontSize: `${captionFontScale}rem` }}
            >
              <p className="text-white" lang={resolved.lang}>
                {resolved.hasTranslation ? resolved.text : translationUnavailable}
              </p>
              {captionMode === "both" && !resolved.isOriginal && (
                <p className="text-xs italic text-white/70" lang={segment.language}>
                  {segment.originalText}
                </p>
              )}
              {showConfidence && translation && (
                <div className="mt-0.5">
                  <ConfidenceBadge
                    score={translation.confidence!}
                    level={translation.confidenceLevel as "high" | "medium" | "low"}
                    rootCause={translation.rootCause as RootCause | null}
                    uiLang={uiLang}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="pointer-events-auto flex items-center gap-1">
        <button
          type="button"
          onClick={shrinkCaptionFont}
          aria-label={dict.shrinkCaptionFont}
          className="font-data flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-xs text-white"
        >
          A-
        </button>
        <button
          type="button"
          onClick={growCaptionFont}
          aria-label={dict.growCaptionFont}
          className="font-data flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-xs text-white"
        >
          A+
        </button>
      </div>
    </div>
  );
}
