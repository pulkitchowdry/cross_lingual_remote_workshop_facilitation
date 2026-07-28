"use client";

import { useMemo } from "react";
import { AudioTrack, isTrackReference, useTracks } from "@livekit/components-react";
import { Track } from "livekit-client";
import { FACILITATOR_IDENTITY_PREFIX, LEARNER_IDENTITY_PREFIX } from "@/components/meeting/use-speaker-languages";
import { useMeetingShell } from "@/components/meeting/MeetingShellContext";
import { resolveLanguage } from "@/lib/i18n";
import type { MeetingTranscriptSegment } from "@/components/meeting/types";
import type { SupportedLanguage } from "@/lib/session-contracts";

/**
 * Replaces the default `<RoomAudioRenderer />` (which only exposes one
 * room-wide `volume` knob — no per-track control, see
 * `RoomAudioRendererProps` in `@livekit/components-react`) so each listener
 * can locally mute a specific speaker's raw mic audio when that speaker's
 * language differs from their own, while a dubbed translation auto-plays
 * instead (`TranslatedAudioPlayer`). Ducking only ever happens when BOTH:
 * `ttsConfigured` is true (with no text-to-speech backend configured,
 * `TranslatedAudioPlayer` never renders any dub audio, so ducking the raw
 * mic anyway would leave a cross-language listener hearing nothing from that
 * speaker at all), AND this listener has turned captions on
 * (`captionsVisible`, from `MeetingShellContext` — the same flag
 * `TranslatedAudioPlayer` gates its own auto-play on). Everyone hears
 * everyone else's raw mic audio regardless of language by default; a dub
 * only ever replaces it once a listener has opted into captions for
 * themselves. This is purely a local rendering choice — it never touches
 * what any other participant hears.
 *
 * Must render every non-mic audio source `RoomAudioRenderer` also covered
 * (`ScreenShareAudio`, `Unknown`) at full volume with no ducking — those
 * aren't attributable to a single speaker's spoken language, and skipping
 * them here would silently break screen-share audio for everyone now that
 * nothing else renders those tracks.
 *
 * Which language to compare against `myLanguage` is read from `transcript`
 * (each segment's STT-detected `language`, the same field `TranslatedAudioPlayer`
 * keys its dub queue off), NOT from the speaker's own `preferredLanguage`
 * attribute (`use-speaker-languages.ts`). That attribute is the language a
 * speaker wants to *read/hear things in* — it says nothing about what
 * language they're actually speaking, and it's set unconditionally at join
 * regardless of whether live transcription has produced anything for them
 * yet. Keying ducking off it caused two same-language speakers (e.g. both
 * actually speaking English) to go silent for each other whenever their
 * chosen attribute values merely differed, and permanently silenced a
 * speaker who never got a caption/transcript segment at all (no dub will
 * ever arrive to replace the raw audio this ducks). Using the transcript's
 * detected language instead means: no segment yet for this speaker -> stay
 * audible (nothing to duck in favor of), and a segment whose detected
 * language matches `myLanguage` -> stay audible even if their attribute
 * says otherwise.
 */
// NOT literal `0` — `livekit-client`'s `RemoteAudioTrack.attach()` only re-applies a
// previously-set volume to a freshly (re-)attached element via `if (this.elementVolume)`
// (node_modules/livekit-client/src/room/track/RemoteAudioTrack.ts), which treats `0` as
// falsy and skips the reapply. Any re-attach after that (e.g. `useTracks()` handing this
// track a new-but-equivalent `TrackReference` object on an unrelated room event, which
// re-runs the underlying attach effect) silently resets the element to the DOM's default
// volume of 1 — full, unducked volume — with no further render to correct it. A value this
// close to zero is inaudible but stays truthy, so the reapply-on-reattach path still fires.
const DUCKED_VOLUME = 0.0001;

export function DuckedRoomAudio({
  myLanguage,
  transcript,
  ttsConfigured,
}: {
  myLanguage: SupportedLanguage;
  /**
   * The session's live transcript (same prop `LiveSessionRoom` already threads to
   * `TranslatedAudioPlayer`) — used to look up each speaker's actual STT-detected
   * spoken language (`segment.speakerId` is that speaker's display name, matching
   * `RemoteParticipant.name`; see `resolveLearnerSpeaker`/`issueCredential`) rather
   * than their self-selected `preferredLanguage` attribute. See the component doc
   * comment above for why.
   */
  transcript: MeetingTranscriptSegment[];
  /**
   * Whether `TranslatedAudioPlayer` actually has a text-to-speech backend to dub
   * from (`textToSpeechProvider.isConfigured`, threaded down from the route page
   * through `LiveSessionRoom`). Ducking a cross-language speaker's raw mic audio
   * is only safe when a dub is actually going to queue up to replace it — without
   * this gate, an unconfigured TTS provider means `TranslatedAudioPlayer` never
   * renders any audio at all, so a ducked listener would hear literally nothing
   * from that speaker for the whole session instead of just their own language.
   */
  ttsConfigured: boolean;
}) {
  // This listener's own "captions on" preference — must render inside
  // `MeetingShellProvider` (see MeetingRoom, which now renders this component
  // for exactly that reason instead of LiveSessionRoom rendering it as a
  // provider-less sibling).
  const { captionsVisible } = useMeetingShell();
  // Last-seen detected spoken language per speaker display name — `transcript` is
  // chronological, so a later segment for the same speaker simply overwrites the
  // map entry, keeping this current as they keep talking.
  const spokenLanguageBySpeaker = useMemo(() => {
    const map: Record<string, SupportedLanguage> = {};
    for (const segment of transcript) {
      if (!segment.speakerId) continue;
      map[segment.speakerId] = resolveLanguage(segment.language);
    }
    return map;
  }, [transcript]);
  const tracks = useTracks([
    { source: Track.Source.Microphone, withPlaceholder: false },
    { source: Track.Source.ScreenShareAudio, withPlaceholder: false },
    { source: Track.Source.Unknown, withPlaceholder: false },
  ])
    // `withPlaceholder: false` above already means no placeholder is ever produced at
    // runtime, but `useTracks`' return type is the same `TrackReferenceOrPlaceholder`
    // union regardless — narrow it explicitly (`isTrackReference` is a proper type
    // guard) so `AudioTrack`'s `trackRef: TrackReference` prop type-checks below.
    .filter(isTrackReference)
    .filter(
      (track) =>
        !track.participant.isLocal &&
        (track.participant.identity.startsWith(FACILITATOR_IDENTITY_PREFIX) || track.participant.identity.startsWith(LEARNER_IDENTITY_PREFIX)),
    );

  return (
    <>
      {tracks.map((track) => {
        const isMic = track.source === Track.Source.Microphone;
        // `track.participant.name` is the LiveKit `RemoteParticipant.name`, set to the
        // same display name `resolveLearnerSpeaker`/facilitator captioning persist as
        // `TranscriptSegment.speakerId` — see the doc comment above.
        const spokenLanguage = spokenLanguageBySpeaker[track.participant.name ?? ""];
        // No transcript segment yet for this speaker (they haven't spoken, or nothing
        // is transcribing them) defaults to audible rather than silently ducked — same
        // reasoning as `ttsConfigured` below: never duck the original raw audio unless
        // a dub is actually going to be available to replace it, otherwise a listener
        // hears nothing at all from that speaker for the entire session.
        const shouldDuck = isMic && ttsConfigured && captionsVisible && spokenLanguage !== undefined && spokenLanguage !== myLanguage;
        return <AudioTrack key={`${track.participant.identity}-${track.source}`} trackRef={track} volume={shouldDuck ? DUCKED_VOLUME : 1} />;
      })}
    </>
  );
}
