"use client";

import { AudioTrack, isTrackReference, useTracks } from "@livekit/components-react";
import { Track } from "livekit-client";
import type { SupportedLanguage } from "@/lib/session-contracts";

/**
 * Plays the facilitator's translated dub audio for this listener's own language —
 * replaces the old per-listener HTTP-fetch-and-queue `TranslatedAudioPlayer`. See
 * `docs/DUB_AUDIO_TRACK_MIGRATION.md`. `caption-agent.ts`'s worker publishes one real
 * LiveKit track per target language, named `dub-<language>` (there is no
 * metadata/attributes field on a published track — see that file's own doc comment —
 * so the track's own `name` is the only discriminator available client-side). Every
 * track publishes under `Track.Source.Unknown`: LiveKit's `TrackSource` enum has no
 * custom value to mark "this is a dub track", so filtering by name is required
 * regardless of source.
 *
 * No conflict with `DuckedRoomAudio`: that component already filters its own
 * `useTracks()` results down to `facilitator:`/`learner:`-prefixed participant
 * identities, so it never picks up the bot's tracks (a different identity) in the
 * first place — this component is the only renderer for `dub-*` tracks.
 */
export function DubAudioPlayer({ myLanguage }: { myLanguage: SupportedLanguage }) {
  const dubTrackName = `dub-${myLanguage}`;
  const track = useTracks([{ source: Track.Source.Unknown, withPlaceholder: false }])
    .filter(isTrackReference)
    .find((candidate) => candidate.publication.trackName === dubTrackName);

  if (!track) return null;
  return <AudioTrack trackRef={track} volume={1} />;
}
