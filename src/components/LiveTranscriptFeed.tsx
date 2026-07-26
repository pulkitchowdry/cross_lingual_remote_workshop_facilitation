"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CaptionComprehensionForm,
  type CaptionComprehensionAction,
} from "@/components/CaptionComprehensionButton";
import type { FormActionResult } from "@/lib/session-contracts";
import { getSpeakerColor } from "@/lib/speaker-color";

export interface TranscriptFeedEntry {
  id: string;
  time: string;
  speaker: string;
  primaryText: string;
  primaryLang: string;
  primaryIsFallback?: boolean;
  secondaryText?: string;
  secondaryLang?: string;
  comprehensionActions?: CaptionComprehensionAction[];
}

type QuestionAction = (prevState: FormActionResult, formData: FormData) => Promise<FormActionResult>;

const BOTTOM_THRESHOLD_PX = 48;

/**
 * YouTube-live-chat-style transcript: a fixed-height, auto-scrolling feed
 * (newest at the bottom) instead of a stacked list of cards. Auto-scroll
 * only kicks in while the viewer is already at the bottom — scrolling up to
 * reread history pauses it, with a "jump to latest" pill to resume, mirroring
 * how YouTube's live chat behaves. Each line shows the translated text by
 * default; the original-language quote (`secondaryText`) stays hidden until
 * that line is clicked, so the feed doesn't read as double-length by default.
 */
export function LiveTranscriptFeed({
  entries,
  emptyLabel,
  jumpToLatestLabel,
  header,
  composer,
  questionAction,
  questionPendingLabel,
}: {
  entries: TranscriptFeedEntry[];
  emptyLabel: string;
  jumpToLatestLabel: string;
  header?: ReactNode;
  composer?: ReactNode;
  questionAction?: QuestionAction;
  questionPendingLabel?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());
  const lastCountRef = useRef(0);

  useEffect(() => {
    const grew = entries.length > lastCountRef.current;
    lastCountRef.current = entries.length;
    const container = scrollRef.current;
    if (!container || !grew || !pinnedToBottom) return;
    container.scrollTop = container.scrollHeight;
  }, [entries.length, pinnedToBottom]);

  function handleScroll() {
    const container = scrollRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    setPinnedToBottom(distanceFromBottom <= BOTTOM_THRESHOLD_PX);
  }

  function scrollToLatest() {
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
    setPinnedToBottom(true);
  }

  function toggleRevealed(id: string) {
    setRevealedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex h-full flex-col rounded-lg border border-border-subtle bg-surface">
      {header && <div className="border-b border-border-subtle p-3">{header}</div>}
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex h-full flex-col gap-0.5 overflow-y-auto p-2"
          aria-live="polite"
        >
          {entries.length > 0 ? (
            entries.map((entry) => {
              const hasSecondary = Boolean(entry.secondaryText);
              const revealed = hasSecondary && revealedIds.has(entry.id);
              const comprehension =
                questionAction && questionPendingLabel && entry.comprehensionActions?.length
                  ? { action: questionAction, pendingLabel: questionPendingLabel, items: entry.comprehensionActions }
                  : null;
              return (
                <div key={entry.id} className={`rounded-md ${hasSecondary ? "hover:bg-surface-raised" : ""}`}>
                  <button
                    type="button"
                    disabled={!hasSecondary}
                    aria-expanded={hasSecondary ? revealed : undefined}
                    onClick={hasSecondary ? () => toggleRevealed(entry.id) : undefined}
                    className={`flex w-full gap-2 rounded-md px-2 py-1.5 text-left ${hasSecondary ? "cursor-pointer" : ""}`}
                  >
                    <span className="font-data shrink-0 pt-0.5 text-[10px] tabular-nums text-muted-foreground">
                      {entry.time}
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="font-data text-xs font-semibold" style={{ color: getSpeakerColor(entry.speaker) }}>
                        {entry.speaker}
                      </span>{" "}
                      <span
                        className="text-sm"
                        lang={entry.primaryLang}
                        style={entry.primaryIsFallback ? { color: "var(--tick-low)" } : undefined}
                      >
                        {entry.primaryText}
                      </span>
                      {revealed && (
                        <p className="mt-0.5 text-xs italic text-muted-foreground" lang={entry.secondaryLang}>
                          {entry.secondaryText}
                        </p>
                      )}
                    </div>
                  </button>
                  {comprehension && (
                    <div className="flex flex-wrap gap-2 px-2 pb-2 pl-16">
                      {comprehension.items.map((item) => (
                        <CaptionComprehensionForm
                          key={item.label}
                          action={comprehension.action}
                          item={item}
                          pendingLabel={comprehension.pendingLabel}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <p className="p-2 text-sm text-muted-foreground">{emptyLabel}</p>
          )}
        </div>
        {!pinnedToBottom && entries.length > 0 && (
          <button
            type="button"
            onClick={scrollToLatest}
            className="font-data absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-border-strong bg-surface-raised px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-foreground shadow"
          >
            {jumpToLatestLabel} ↓
          </button>
        )}
      </div>
      {composer}
    </div>
  );
}
