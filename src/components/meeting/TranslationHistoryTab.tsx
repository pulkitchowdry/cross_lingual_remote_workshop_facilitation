"use client";

import { useMemo, type ReactNode } from "react";
import { LiveTranscriptFeed, type TranscriptFeedEntry } from "@/components/LiveTranscriptFeed";
import { CaptionComprehensionActions } from "@/components/CaptionComprehensionActions";
import { ClarificationActions } from "@/components/ClarificationActions";
import { resolveTranslatedText } from "@/lib/translation-view";
import { getDictionary } from "@/lib/i18n";
import { ConfidenceBadge } from "@/components/ui/ConfidenceBadge";
import type { MeetingTranscriptSegment } from "@/components/meeting/types";
import { truncateForQuotedQuestion, type FormActionResult, type SupportedLanguage } from "@/lib/session-contracts";
import type { RootCause } from "@/lib/confidence";

/**
 * The meeting sidebar's "Captions" tab — the same transcript history as the
 * dashboard's SessionSidePanel, just built client-side from the `transcript` prop
 * MeetingRoom already threads down for CaptionOverlay, instead of a second
 * server-computed prop shaped like TranscriptFeedEntry[]. `resolveTranslatedText`
 * is the same resolution CaptionOverlay itself uses, against `uiLang` — this
 * component and CaptionOverlay always agree on which language a segment reads in.
 */
export function TranslationHistoryTab({
  transcript,
  uiLang,
  emptyLabel,
  header,
  composer,
  sendChatAction,
  viewerIsFacilitator,
}: {
  transcript: MeetingTranscriptSegment[];
  uiLang: SupportedLanguage;
  emptyLabel: string;
  header?: ReactNode;
  composer?: ReactNode;
  /** Present for a learner viewer only (see MeetingSidebar) — lets each caption's
   * "Explain simply"/"Give an example" quick-questions actually submit. Omitted
   * entirely for the facilitator's own read-only feed, same as the dashboard's
   * CaptionComprehensionActions usage in learn/page.tsx. */
  sendChatAction?: (prevState: FormActionResult, formData: FormData) => Promise<FormActionResult>;
  viewerIsFacilitator?: boolean;
}) {
  const dict = getDictionary(uiLang);

  // Memoized — this tab's `transcript` prop is re-fetched (new array/object references
  // every time) on every `router.refresh()`, and CaptionChannelRefresher triggers one on
  // EVERY caption published by ANY participant in the room, in addition to
  // SessionAutoRefresh's independent 2s poll. Without this, the full transcript remap
  // (plus a fresh ConfidenceBadge/CaptionComprehensionActions/ClarificationActions
  // element tree per segment) reran on essentially every caption tick from every
  // speaker, growing with total session length instead of staying bounded to what
  // actually changed.
  const entries: TranscriptFeedEntry[] = useMemo(() => {
    const learnerDict = dict.learner;
    const timeFormatter = new Intl.DateTimeFormat(uiLang, { hour: "2-digit", minute: "2-digit" });
    // Precomputed once, not per-line — see ClarificationActions' reasonLabels prop
    // (mirrors learn/page.tsx's identical precomputation).
    const clarificationReasonLabels = {
      "could-not-hear": dict.common.clarificationReasonCouldNotHear,
      "translation-incorrect": dict.common.clarificationReasonTranslationIncorrect,
      "please-repeat": dict.common.clarificationReasonPleaseRepeat,
      "explain-differently": dict.common.clarificationReasonExplainDifferently,
    } as const;

    return transcript.map((segment) => {
      const resolved = resolveTranslatedText(segment, uiLang);
      const isOriginal = segment.language === uiLang;
      // Confidence Score (issue #130) only applies to translated lines — the same
      // lookup CaptionOverlay/learn/page.tsx/facilitator/page.tsx already use against
      // this identical `transcript` prop shape; this tab was simply never wired up to
      // it, so the badge never appeared in the meeting sidebar's Captions tab.
      const translation = segment.translations.find((item) => item.targetLanguage === uiLang);
      // Same computation as learn/page.tsx's `needsClarification` — a learner inside
      // the live meeting room previously never saw "Request clarification" for a
      // Medium/Low-confidence caption even though the pre-live dashboard already
      // offered it for the identical segment/translation shape.
      const needsClarification = !isOriginal && translation?.confidenceLevel && translation.confidenceLevel !== "high";
      return {
        id: segment.id,
        time: timeFormatter.format(new Date(segment.startedAt)),
        speaker: segment.speakerId ?? dict.common.speaker,
        primaryText: resolved.hasTranslation ? resolved.text : dict.common.translationUnavailable,
        // The fallback text (dict.common.translationUnavailable) is itself localized to
        // `uiLang`, not fixed English copy — tag it `uiLang`, not "en".
        primaryLang: resolved.hasTranslation ? resolved.lang : uiLang,
        primaryIsFallback: !resolved.hasTranslation,
        secondaryText: !isOriginal ? segment.originalText : undefined,
        secondaryLang: !isOriginal ? segment.language : undefined,
        confidenceBadge:
          !isOriginal && translation?.confidence != null && translation.confidenceLevel ? (
            <ConfidenceBadge
              score={translation.confidence}
              level={translation.confidenceLevel as "high" | "medium" | "low"}
              rootCause={translation.rootCause as RootCause | null}
              uiLang={uiLang}
              translationScore={translation.translationConfidence}
              networkScore={segment.networkQuality}
              speechRecognitionScore={segment.sttConfidence}
            />
          ) : undefined,
        // Same restriction as the dashboard's CaptionComprehensionActions (learn/page.tsx):
        // only a learner gets to ask about a caption, never the facilitator's own read-only
        // feed — this tab previously omitted the actions entirely for everyone, which is the
        // regression this restores for the *live* room (the dashboard already had it).
        actions:
          !viewerIsFacilitator && sendChatAction ? (
            <div className="flex flex-col gap-2">
              <CaptionComprehensionActions
                sendAction={sendChatAction}
                explainSimplyLabel={learnerDict.explainSimply}
                giveExampleLabel={learnerDict.giveExample}
                sendingLabel={dict.chat.sending}
                explainSimplyMessage={learnerDict.explainSimplyQuestion(truncateForQuotedQuestion(segment.originalText))}
                giveExampleMessage={learnerDict.giveExampleQuestion(truncateForQuotedQuestion(segment.originalText))}
              />
              {needsClarification && (
                <ClarificationActions
                  sendAction={sendChatAction}
                  originalText={segment.originalText}
                  requestClarificationLabel={dict.common.requestClarification}
                  reasonLabels={clarificationReasonLabels}
                  sendingLabel={dict.chat.sending}
                />
              )}
            </div>
          ) : undefined,
      };
    });
  }, [transcript, uiLang, viewerIsFacilitator, sendChatAction, dict]);

  return (
    <LiveTranscriptFeed
      entries={entries}
      emptyLabel={emptyLabel}
      jumpToLatestLabel={dict.common.jumpToLatest}
      header={header}
      composer={composer}
    />
  );
}
