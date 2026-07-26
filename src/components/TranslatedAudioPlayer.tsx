"use client";

import { useEffect, useRef, useState } from "react";
import { getDictionary, resolveLanguage } from "@/lib/i18n";

interface CaptionForPlayback {
  id: string;
  hasTranslation: boolean;
  isTyped: boolean;
}

// isTyped travels with each queue entry (not just a bare id) so the
// disable-opt-in effect below can tell which queued/playing segments are
// facilitator/learner-typed captions (must always play, per the doc comment
// below) apart from ones queued only because the opt-in was on.
interface QueueEntry {
  id: string;
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
type PlaybackErrorKind = "blocked" | "skipped";

export function TranslatedAudioPlayer({ segments, preferredLanguage }: { segments: CaptionForPlayback[]; preferredLanguage: string }) {
  const dict = getDictionary(resolveLanguage(preferredLanguage)).learner;
  const [enabled, setEnabled] = useState(false);
  // The error *kind*, not the already-resolved dictionary string — `dict` is
  // recomputed from `preferredLanguage` on every render, so deriving the displayed
  // text from this kind at render time (below) keeps it in sync when the learner
  // switches languages mid-session. Storing the resolved string directly (the
  // previous approach) kept showing the OLD language's error text after a language
  // switch, since nothing re-derived it once it was already in state.
  const [errorKind, setErrorKind] = useState<PlaybackErrorKind | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const hasMountedRef = useRef(false);
  const queueRef = useRef<QueueEntry[]>([]);
  const playingRef = useRef(false);
  // The entry currently loaded into <audio> (playing, or about to play once
  // its play() promise resolves) — null when nothing is in flight. Used by
  // the disable-opt-in effect to decide whether the in-flight item must
  // survive (isTyped) or gets cut off.
  const currentRef = useRef<QueueEntry | null>(null);
  // Bumped on every playNext() call. A failed load rejects the pending
  // play() promise AND fires <audio onError> for that same attempt — both
  // handlers check this token before mutating playback state, so whichever
  // one runs second (after the other has already advanced the queue to a
  // new attempt) is a no-op instead of double-advancing and skipping a good
  // segment.
  const attemptTokenRef = useRef(0);

  const playNext = () => {
    const audio = audioRef.current;
    const next = queueRef.current.shift();
    if (!audio || !next) {
      playingRef.current = false;
      currentRef.current = null;
      return;
    }
    playingRef.current = true;
    currentRef.current = next;
    const token = ++attemptTokenRef.current;
    audio.src = `/api/captions/${next.id}/audio?lang=${encodeURIComponent(preferredLanguage)}`;
    void audio.play().catch((playError: unknown) => {
      // A failed load rejects this promise *and* fires <audio onError> for
      // the same attempt — handlePlaybackError is the single source of truth
      // for "this segment's resource failed" and already advances the queue,
      // so don't also advance here (that double-advance used to skip a good
      // segment that never got a chance to play). The one failure onError
      // can't see is the browser refusing to play a resource that loaded
      // fine (autoplay block) — handle only that here, and only if a later
      // attempt hasn't already superseded this one.
      if (token !== attemptTokenRef.current) return;
      if (playError instanceof DOMException && playError.name === "NotAllowedError") {
        setErrorKind("blocked");
        playingRef.current = false;
        currentRef.current = null;
        playNext();
      }
    });
  };

  const handlePlaybackError = () => {
    // <audio onError> covers every failed load (404/502/503 from the audio
    // route, network error) — surface it instead of silently treating a
    // failed segment the same as one that finished normally. This is the
    // single source of truth for load failures (see playNext's catch).
    setErrorKind("skipped");
    playNext();
  };
  const error = errorKind === "blocked" ? dict.audioBlocked : errorKind === "skipped" ? dict.audioSkipped : null;

  useEffect(() => {
    // Only mark a segment "seen" once it actually has a translation, not the moment
    // its id first shows up in `segments` — translation runs asynchronously (up to
    // ~16s, see `publishCaption`) and SessionAutoRefresh polls every 2s, so a segment
    // routinely appears here several times *before* its translation lands. Marking it
    // seen on that first, translation-less appearance permanently disqualified it: by
    // the time `hasTranslation` flipped to true on a later poll, `unseen` had already
    // excluded it, so its audio silently never queued — the caption played nothing.
    const newlyTranslated = segments.filter(
      (segment) => segment.hasTranslation && !seenIdsRef.current.has(segment.id),
    );
    newlyTranslated.forEach((segment) => seenIdsRef.current.add(segment.id));
    // Skip the initial mount's batch — otherwise every typed caption already
    // in the transcript before this learner loaded the page would replay as
    // audio the instant the component mounts.
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    const toQueue = newlyTranslated.filter((segment) => segment.isTyped || enabled);
    if (toQueue.length === 0) return;

    queueRef.current.push(...toQueue.map((segment) => ({ id: segment.id, isTyped: segment.isTyped })));
    if (!playingRef.current) playNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, enabled]);

  useEffect(() => {
    // Unchecking the box must actually silence playback that exists *because
    // of* the opt-in, not just stop queueing new segments — without this,
    // whatever was already playing (or queued right behind it) kept right on
    // talking after the learner turned the control off. But typed captions
    // stand in for the facilitator's voice and always play regardless of the
    // opt-in (see the doc comment above), so only cut off entries that are
    // NOT isTyped — a typed segment already playing or queued keeps going.
    if (enabled) return;
    const current = currentRef.current;
    if (current && !current.isTyped) {
      audioRef.current?.pause();
      playingRef.current = false;
      currentRef.current = null;
    }
    queueRef.current = queueRef.current.filter((entry) => entry.isTyped);
    // If we just cut off a non-typed current item (or nothing was playing),
    // resume immediately so any surviving typed entries aren't stranded in
    // the queue until the next `segments` update happens to trigger playNext.
    if (!playingRef.current && queueRef.current.length > 0) playNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

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
        <audio
          ref={audioRef}
          onEnded={playNext}
          onError={handlePlaybackError}
          // A prior transient failure (e.g. the very first play() blocked by
          // the browser's autoplay policy) must not leave the error banner
          // shown forever once playback actually recovers — clear it the
          // moment a segment genuinely starts playing.
          onPlaying={() => setErrorKind(null)}
          className="hidden"
        />
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
