"use client";

import { useEffect, useRef, useState } from "react";
import { getDictionary, resolveLanguage } from "@/lib/i18n";

interface CaptionForPlayback {
  id: string;
  hasTranslation: boolean;
  isTyped: boolean;
  /** The speaker's own language for this segment — compared against `preferredLanguage`
   * to decide whether this listener should hear a dub automatically (see the doc
   * comment below). */
  language: string;
}

// alwaysPlay travels with each queue entry (not just a bare id) so the
// disable-opt-in effect below can tell which queued/playing segments must play
// regardless of the opt-in (typed captions, and any cross-language segment —
// see the doc comment below) apart from ones queued only because the opt-in
// was on (a same-language segment the listener chose to hear dubbed anyway).
interface QueueEntry {
  id: string;
  alwaysPlay: boolean;
  /** The segment's own typed-flag/language, kept alongside `alwaysPlay` so the
   * preferredLanguage-reconciliation effect below can recompute whether this entry is
   * still alwaysPlay-worthy under a NEW preferred language without re-fetching the
   * segment from `segments`. */
  isTyped: boolean;
  language: string;
}

/**
 * Translated-audio playback for the learner's caption feed — Part 3 of
 * `docs/TRANSLATION_ARCHITECTURE.md`. A spoken caption in a *different*
 * language than this listener's own auto-plays its dub by default — the
 * raw speaker audio is ducked for them locally (see `DuckedRoomAudio`), so
 * without this they'd hear nothing at all for that speaker. Facilitator- and
 * learner-typed captions are a second, independent always-play case — they
 * stand in for a speaker's voice when they can't/didn't speak, not a
 * translation nicety. `enabled` is now only an opt-*in* for the narrow
 * remaining case of a same-language segment (the listener wants to hear a
 * dub even though they'd understand the original fine) — everything that
 * needs a dub to be heard at all already plays without it. Fetches
 * `/api/captions/[segmentId]/audio` on demand for each new segment and
 * queues playback so overlapping captions don't talk over each other.
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
  // survive (alwaysPlay) or gets cut off.
  const currentRef = useRef<QueueEntry | null>(null);
  // Bumped on every playNext() call. A failed load rejects the pending
  // play() promise AND fires <audio onError> for that same attempt — both
  // handlers check this token before mutating playback state, so whichever
  // one runs second (after the other has already advanced the queue to a
  // new attempt) is a no-op instead of double-advancing and skipping a good
  // segment.
  const attemptTokenRef = useRef(0);

  const playBlockedSegment = () => {
    const audio = audioRef.current;
    // A direct call inside a real click handler — unlike the original attempt inside
    // playNext's own promise chain, this one runs synchronously within a genuine user
    // gesture, so the browser's autoplay policy allows it. `audio.src` is still set to
    // the blocked segment from the failed attempt; no need to re-fetch it.
    void audio?.play().catch(() => {
      // Still blocked somehow (shouldn't happen from within a real click, but stay
      // defensive) — leave errorKind as "blocked" so the retry button stays visible.
    });
  };

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
        // Deliberately NOT advancing the queue here (unlike every other failure path in
        // this file) — an autoplay block applies to every subsequent attempt just as
        // much as this one, so calling playNext() would silently burn through the
        // entire queue one blocked segment at a time until the listener happened to
        // interact with the page for an unrelated reason. `currentRef`/`playingRef`
        // stay as they are (audio.src is still this segment's URL) so `playBlockedSegment`
        // can retry the exact same element from within a real click, and `onEnded`/
        // `onPlaying` below resume normal queue processing once it actually plays.
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
    // Prune ids no longer present so a long session's set doesn't grow unbounded — same
    // bookkeeping shape as CaptionOverlay's own firstSeenAt map (see that file's comment).
    const currentIds = new Set(segments.map((segment) => segment.id));
    for (const id of seenIdsRef.current) {
      if (!currentIds.has(id)) seenIdsRef.current.delete(id);
    }
    // Skip the initial mount's batch — otherwise every typed caption already
    // in the transcript before this learner loaded the page would replay as
    // audio the instant the component mounts.
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    const toQueue = newlyTranslated.filter((segment) => segment.isTyped || segment.language !== preferredLanguage || enabled);
    if (toQueue.length === 0) return;

    queueRef.current.push(
      ...toQueue.map((segment) => ({
        id: segment.id,
        alwaysPlay: segment.isTyped || segment.language !== preferredLanguage,
        isTyped: segment.isTyped,
        language: segment.language,
      })),
    );
    if (!playingRef.current) playNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, enabled, preferredLanguage]);

  useEffect(() => {
    // Unchecking the box must actually silence playback that exists *because
    // of* the opt-in, not just stop queueing new segments — without this,
    // whatever was already playing (or queued right behind it) kept right on
    // talking after the learner turned the control off. But typed captions and
    // cross-language segments always play regardless of the opt-in (see the
    // doc comment above), so only cut off entries that are NOT `alwaysPlay` —
    // one of those already playing or queued keeps going.
    if (enabled) return;
    const current = currentRef.current;
    if (current && !current.alwaysPlay) {
      audioRef.current?.pause();
      playingRef.current = false;
      currentRef.current = null;
      // If `current` was sitting in an autoplay-blocked state (errorKind === "blocked"),
      // it's the segment the "Play blocked audio" retry button would resurrect — clear
      // the error along with it so a learner who opts back out doesn't leave a stale
      // button around that replays the exact dub they just declined.
      setErrorKind(null);
    }
    queueRef.current = queueRef.current.filter((entry) => entry.alwaysPlay);
    // If we just cut off a non-always-play current item (or nothing was
    // playing), resume immediately so any surviving always-play entries
    // aren't stranded in the queue until the next `segments` update happens
    // to trigger playNext.
    if (!playingRef.current && queueRef.current.length > 0) playNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const preferredLanguageRef = useRef(preferredLanguage);
  useEffect(() => {
    const previousLanguage = preferredLanguageRef.current;
    preferredLanguageRef.current = preferredLanguage;
    if (previousLanguage === preferredLanguage) return;

    // A caption already sitting in the queue (or mid-playback) was marked `alwaysPlay`
    // against the OLD preferredLanguage — e.g. it was cross-language relative to that
    // old language, so it queued regardless of the opt-in. After the switch, that same
    // segment may now be same-language, and a stale queued/playing dub for it would talk
    // over the (now un-ducked) live mic audio for that speaker instead of standing in for
    // it. Recompute `alwaysPlay` under the NEW preferredLanguage — typed captions always
    // stay; anything still cross-language stays; anything that's now same-language is
    // dropped unless the opt-in checkbox is on (mirrors the `[enabled]` effect above,
    // which keeps a non-alwaysPlay entry only while the opt-in is checked).
    const recompute = (entry: QueueEntry): QueueEntry => ({
      ...entry,
      alwaysPlay: entry.isTyped || entry.language !== preferredLanguage,
    });

    if (currentRef.current) {
      const current = recompute(currentRef.current);
      currentRef.current = current;
      if (!current.alwaysPlay && !enabled) {
        audioRef.current?.pause();
        playingRef.current = false;
        currentRef.current = null;
        setErrorKind(null);
      }
    }

    queueRef.current = queueRef.current.map(recompute).filter((entry) => entry.alwaysPlay || enabled);

    if (!playingRef.current && queueRef.current.length > 0) playNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferredLanguage]);

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
          <p className="animate-fade-in text-xs" role="alert" style={{ color: "var(--tick-low)" }}>
            {error}
          </p>
        )}
        {errorKind === "blocked" && (
          <button
            type="button"
            onClick={playBlockedSegment}
            className="font-data press-scale animate-fade-in flex min-h-11 shrink-0 items-center rounded-md border border-border-strong px-3 text-xs font-medium uppercase tracking-wider text-foreground transition-colors"
          >
            {dict.playBlockedAudio}
          </button>
        )}
      </div>
    </div>
  );
}
