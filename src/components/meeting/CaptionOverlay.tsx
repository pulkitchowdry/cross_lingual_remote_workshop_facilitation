"use client";

import { useMeetingShell } from "@/components/meeting/MeetingShellContext";
import { resolveTranslatedText } from "@/lib/translation-view";
import { getDictionary } from "@/lib/i18n";
import { ConfidenceBadge } from "@/components/ui/ConfidenceBadge";
import type { MeetingTranscriptSegment } from "@/components/meeting/types";
import type { SupportedLanguage } from "@/lib/session-contracts";
import type { RootCause } from "@/lib/confidence";

const RECENT_SEGMENT_COUNT = 3;

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

  if (!captionsVisible || transcript.length === 0) return null;

  const recent = transcript.slice(-RECENT_SEGMENT_COUNT);

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
          className="font-data flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-xs text-white"
        >
          A-
        </button>
        <button
          type="button"
          onClick={growCaptionFont}
          aria-label={dict.growCaptionFont}
          className="font-data flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-xs text-white"
        >
          A+
        </button>
      </div>
    </div>
  );
}
