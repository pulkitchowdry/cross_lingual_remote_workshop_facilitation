"use client";

import { AudioTrack, isTrackReference, useTracks } from "@livekit/components-react";
import { Track } from "livekit-client";
import { useSpeakerLanguages, FACILITATOR_IDENTITY_PREFIX, LEARNER_IDENTITY_PREFIX } from "@/components/meeting/use-speaker-languages";
import type { SupportedLanguage } from "@/lib/session-contracts";

/**
 * Replaces the default `<RoomAudioRenderer />` (which only exposes one
 * room-wide `volume` knob — no per-track control, see
 * `RoomAudioRendererProps` in `@livekit/components-react`) so each listener
 * can locally mute a specific speaker's raw mic audio when that speaker's
 * language differs from their own, while a dubbed translation auto-plays
 * instead (`TranslatedAudioPlayer`). Only ever ducks when `ttsConfigured` is
 * true — with no text-to-speech backend configured, `TranslatedAudioPlayer`
 * never renders any dub audio, so ducking the raw mic anyway would leave a
 * cross-language listener hearing nothing from that speaker at all. This is
 * purely a local rendering choice — it never touches what any other
 * participant hears.
 *
 * Must render every non-mic audio source `RoomAudioRenderer` also covered
 * (`ScreenShareAudio`, `Unknown`) at full volume with no ducking — those
 * aren't attributable to a single speaker's spoken language, and skipping
 * them here would silently break screen-share audio for everyone now that
 * nothing else renders those tracks.
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
  facilitatorSourceLanguage,
  ttsConfigured,
}: {
  myLanguage: SupportedLanguage;
  facilitatorSourceLanguage: SupportedLanguage;
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
  const speakerLanguages = useSpeakerLanguages(facilitatorSourceLanguage);
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
        const speakerLanguage = speakerLanguages[track.participant.identity];
        // Unknown speaker language (the narrow staleness window
        // `SyncParticipantLanguageAttribute` documents) defaults to audible
        // rather than silently ducked — a listener briefly hearing an
        // unexpected language for a moment is a far smaller problem than a
        // speaker going randomly inaudible. Same reasoning for `ttsConfigured`:
        // never duck the original raw audio unless a dub is actually going to be
        // available to replace it — otherwise a listener hears nothing at all
        // from a cross-language speaker for the entire session.
        const shouldDuck = isMic && ttsConfigured && speakerLanguage !== undefined && speakerLanguage !== myLanguage;
        return <AudioTrack key={`${track.participant.identity}-${track.source}`} trackRef={track} volume={shouldDuck ? DUCKED_VOLUME : 1} />;
      })}
    </>
  );
}
