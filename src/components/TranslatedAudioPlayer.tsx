"use client";

import { useEffect, useRef, useState } from "react";
import { getDictionary, resolveLanguage } from "@/lib/i18n";

interface CaptionForPlayback {
  id: string;
  hasTranslation: boolean;
  isTyped: boolean;
}

/**
 * Translated-audio playback for the learner's caption feed — Part 3 of
 * `docs/TRANSLATION_ARCHITECTURE.md`. Spoken captions stay opt-in: nothing is
 * synthesized or played until the learner explicitly enables it, per the
 * doc's privacy decision. Facilitator-typed captions are the exception —
 * they stand in for the facilitator's voice (typed because they can't speak,
 * not as a translation nicety), so those always play regardless of the
 * opt-in. Fetches `/api/captions/[segmentId]/audio` on demand for each new
 * segment and queues playback so overlapping captions don't talk over each
 * other.
 */
export function TranslatedAudioPlayer({ segments, preferredLanguage }: { segments: CaptionForPlayback[]; preferredLanguage: string }) {
  const dict = getDictionary(resolveLanguage(preferredLanguage)).learner;
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const hasMountedRef = useRef(false);
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
    const unseen = segments.filter((segment) => !seenIdsRef.current.has(segment.id));
    segments.forEach((segment) => seenIdsRef.current.add(segment.id));
    // Skip the initial mount's batch — otherwise every typed caption already
    // in the transcript before this learner loaded the page would replay as
    // audio the instant the component mounts.
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    const toQueue = unseen.filter((segment) => segment.hasTranslation && (segment.isTyped || enabled));
    if (toQueue.length === 0) return;

    queueRef.current.push(...toQueue.map((segment) => segment.id));
    if (!playingRef.current) playNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, enabled]);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            className="h-3.5 w-3.5 accent-[var(--accent)]"
          />
          {dict.playTranslatedAudio}
        </label>
        <audio ref={audioRef} onEnded={playNext} onError={handlePlaybackError} className="hidden" />
        {error && (
          <p className="text-xs" role="alert" style={{ color: "var(--tick-low)" }}>
            {error}
          </p>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{dict.typedCaptionsAlwaysAudible}</p>
    </div>
  );
}
