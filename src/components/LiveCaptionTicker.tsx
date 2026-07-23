"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfidenceTick } from "@/components/ui/ConfidenceTick";
import { getSpeakerColor } from "@/lib/speaker-color";
import type { TranscriptEntry } from "@/lib/types";

const REVEAL_INTERVAL_MS = 1800;
const SCROLL_BOTTOM_THRESHOLD_PX = 24;

export function LiveCaptionTicker({
  feed,
  label = "Live captions",
}: {
  feed: TranscriptEntry[];
  label?: string;
}) {
  const [revealedCount, setRevealedCount] = useState(feed.length > 0 ? 1 : 0);
  const [isPaused, setIsPaused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (revealedCount >= feed.length) return;
    const id = setInterval(() => {
      setRevealedCount((count) => Math.min(count + 1, feed.length));
    }, REVEAL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [revealedCount, feed.length]);

  useEffect(() => {
    if (isPaused) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [revealedCount, isPaused]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setIsPaused(distanceFromBottom > SCROLL_BOTTOM_THRESHOLD_PX);
  }

  function jumpToLive() {
    setIsPaused(false);
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  const revealed = feed.slice(0, revealedCount);

  return (
    <div className="relative flex flex-col gap-2">
      <h2 className="font-heading text-lg font-semibold">{label}</h2>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        aria-live="polite"
        aria-atomic="false"
        className="flex max-h-56 flex-col gap-2 overflow-y-auto rounded-lg border border-border-subtle bg-surface-raised p-3"
      >
        {revealed.map((entry) => {
          const speakerColor = getSpeakerColor(entry.speaker);
          return (
            <div
              key={entry.id}
              className="flex flex-col gap-1 border-l-2 pl-2"
              style={{ borderColor: speakerColor }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-heading text-xs font-semibold" style={{ color: speakerColor }}>
                  {entry.speaker}
                </span>
                <ConfidenceTick confidence={entry.confidence} />
              </div>
              <p className="text-sm leading-snug text-foreground">{entry.translation}</p>
              <p className="text-xs italic text-muted-foreground" lang="und">
                {entry.original}
              </p>
            </div>
          );
        })}
      </div>
      {isPaused && (
        <Button
          onClick={jumpToLive}
          className="absolute bottom-3 right-3 text-xs"
        >
          Jump to live
        </Button>
      )}
    </div>
  );
}
