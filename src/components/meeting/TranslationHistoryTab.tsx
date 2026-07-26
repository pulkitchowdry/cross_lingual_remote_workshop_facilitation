"use client";

import type { ReactNode } from "react";
import { LiveTranscriptFeed, type TranscriptFeedEntry } from "@/components/LiveTranscriptFeed";
import { resolveTranslatedText } from "@/lib/translation-view";
import { getDictionary } from "@/lib/i18n";
import type { MeetingTranscriptSegment } from "@/components/meeting/types";
import type { SupportedLanguage } from "@/lib/session-contracts";

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
}: {
  transcript: MeetingTranscriptSegment[];
  uiLang: SupportedLanguage;
  emptyLabel: string;
  header?: ReactNode;
  composer?: ReactNode;
}) {
  const dict = getDictionary(uiLang);
  const timeFormatter = new Intl.DateTimeFormat(uiLang, { hour: "2-digit", minute: "2-digit" });

  const entries: TranscriptFeedEntry[] = transcript.map((segment) => {
    const resolved = resolveTranslatedText(segment, uiLang);
    const isOriginal = segment.language === uiLang;
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
    };
  });

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
