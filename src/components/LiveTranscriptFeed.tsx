"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
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
  /** Learner-only per-line actions (e.g. "explain simply"), rendered below an entry
   * once it's expanded. A pre-built element, not a callback — this crosses the
   * server/client component boundary (LearnerSessionPage is a Server Component;
   * this feed is a Client Component), and only React elements serialize across
   * that boundary, not arbitrary functions. Omitted entirely on the facilitator's
   * read-only feed. */
  actions?: ReactNode;
  /** Confidence Score badge (issue #130) for this line's translation — a pre-built
   * element for the same server/client boundary reason as `actions`. Omitted for a
   * learner's own-language lines (no translation involved) and on facilitator's
   * read-only feed rows that don't carry one. */
  confidenceBadge?: ReactNode;
}

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
}: {
  entries: TranscriptFeedEntry[];
  emptyLabel: string;
  jumpToLatestLabel: string;
  header?: ReactNode;
  composer?: ReactNode;
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
              // With `actions`, every line is expandable — a learner may want to ask
              // about a caption spoken in their own preferred language too, where
              // there's no secondaryText (original-language quote) to reveal.
              const isExpandable = hasSecondary || Boolean(entry.actions);
              const revealed = isExpandable && revealedIds.has(entry.id);
              return (
                <div key={entry.id}>
                  <button
                    type="button"
                    disabled={!isExpandable}
                    aria-expanded={isExpandable ? revealed : undefined}
                    onClick={isExpandable ? () => toggleRevealed(entry.id) : undefined}
                    className={`flex w-full gap-2 rounded-md px-2 py-1.5 text-left ${
                      isExpandable ? "cursor-pointer hover:bg-surface-raised" : ""
                    }`}
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
                      {revealed && hasSecondary && (
                        <p className="mt-0.5 text-xs italic text-muted-foreground" lang={entry.secondaryLang}>
                          {entry.secondaryText}
                        </p>
                      )}
                    </div>
                  </button>
                  {/* Rendered outside the row's own toggle `<button>` above, not nested inside
                      it — a disabled `<button>` (a row with nothing else to expand) suppresses
                      pointer events for its entire subtree in Chromium, which made the badge's
                      own `<details>` disclosure completely unclickable when nested inside one. */}
                  {entry.confidenceBadge && <div className="pb-1 pl-9 pr-2">{entry.confidenceBadge}</div>}
                  {revealed && entry.actions && <div className="pb-1 pl-9 pr-2">{entry.actions}</div>}
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
