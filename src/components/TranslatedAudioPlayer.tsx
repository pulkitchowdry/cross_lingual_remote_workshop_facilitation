"use client";

import { useEffect, useRef, useState } from "react";
import { getDictionary, resolveLanguage } from "@/lib/i18n";

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
  const dict = getDictionary(resolveLanguage(preferredLanguage)).learner;
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
    void audio.play().catch(() => {
      // A rejected play() (autoplay block, decode error, aborted load) never
      // fires onEnded/onError, so without this the queue would silently wedge
      // forever on the first failure while the checkbox still reads "on".
      setError(dict.audioBlocked);
      playingRef.current = false;
      playNext();
    });
  };

  const handlePlaybackError = () => {
    // <audio onError> covers every failed load (404/502/503 from the audio
    // route, network error) — surface it instead of silently treating a
    // failed segment the same as one that finished normally.
    setError(dict.audioSkipped);
    playNext();
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
        {dict.playTranslatedAudio}
      </label>
      <audio ref={audioRef} onEnded={playNext} onError={handlePlaybackError} className="hidden" />
      {error && (
        <p className="text-xs" role="alert" style={{ color: "var(--tick-low)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
