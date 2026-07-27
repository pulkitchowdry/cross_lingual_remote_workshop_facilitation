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
 * instead (`TranslatedAudioPlayer`). This is purely a local rendering choice
 * — it never touches what any other participant hears.
 *
 * Must render every non-mic audio source `RoomAudioRenderer` also covered
 * (`ScreenShareAudio`, `Unknown`) at full volume with no ducking — those
 * aren't attributable to a single speaker's spoken language, and skipping
 * them here would silently break screen-share audio for everyone now that
 * nothing else renders those tracks.
 */
export function DuckedRoomAudio({ myLanguage, facilitatorSourceLanguage }: { myLanguage: SupportedLanguage; facilitatorSourceLanguage: SupportedLanguage }) {
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
        // speaker going randomly inaudible.
        const shouldDuck = isMic && speakerLanguage !== undefined && speakerLanguage !== myLanguage;
        return <AudioTrack key={`${track.participant.identity}-${track.source}`} trackRef={track} volume={shouldDuck ? 0 : 1} />;
      })}
    </>
  );
}
