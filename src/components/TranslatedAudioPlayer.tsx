"use client";

import { useEffect, useRef, useState } from "react";

interface CaptionForPlayback {
  id: string;
  hasTranslation: boolean;
}

/**
 * Opt-in translated-audio playback for the learner's caption feed — Part 3 of
 * `docs/TRANSLATION_ARCHITECTURE.md`. Never autoplays: nothing is synthesized
 * or played until the learner explicitly enables it, per the doc's privacy
 * decision. Fetches `/api/captions/[segmentId]/audio` on demand for each new
 * segment and queues playback so overlapping captions don't talk over each
 * other.
 */
export function TranslatedAudioPlayer({ segments, preferredLanguage }: { segments: CaptionForPlayback[]; preferredLanguage: string }) {
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<string[]>([]);
  const playingRef = useRef(false);

  const playNext = () => {
    const audio = audioRef.current;
    const nextId = queueRef.current.shift();
    if (!audio || !nextId) {
      playingRef.current = false;
      return;
    }
    playingRef.current = true;
    audio.src = `/api/captions/${nextId}/audio?lang=${encodeURIComponent(preferredLanguage)}`;
    void audio.play().catch(() => setError("Translated audio playback was blocked by the browser."));
  };

  useEffect(() => {
    const unseen = segments.filter((segment) => segment.hasTranslation && !seenIdsRef.current.has(segment.id));
    segments.forEach((segment) => seenIdsRef.current.add(segment.id));
    if (!enabled || unseen.length === 0) return;

    queueRef.current.push(...unseen.map((segment) => segment.id));
    if (!playingRef.current) playNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, enabled]);

  return (
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
        Play translated audio for new captions
      </label>
      <audio ref={audioRef} onEnded={playNext} onError={playNext} className="hidden" />
      {error && (
        <p className="text-xs" style={{ color: "var(--tick-low)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
