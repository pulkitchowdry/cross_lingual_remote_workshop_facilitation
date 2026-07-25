import { AutoSubscribe, defineAgent, type JobContext } from "@livekit/agents";
import { AudioStream, RemoteAudioTrack, RoomEvent, type RemoteParticipant, type RemoteTrack } from "@livekit/rtc-node";
import { SessionStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { publishTranslatedCaption } from "@/lib/captions";
import { clearCaptionAgentCapturing, markCaptionAgentCapturing } from "@/lib/caption-source-state";
import { speechToTextProvider } from "@/lib/providers/speech-to-text";
import type { SupportedLanguage } from "@/lib/session-contracts";

const WORKSHOP_ROOM_PREFIX = "workshop-";
const FACILITATOR_IDENTITY_PREFIX = "facilitator:";
/**
 * Rate the agent asks LiveKit to resample the facilitator's track to before
 * handing frames to Deepgram — matches the `linear16` PCM framing passed to
 * `openStream`'s `encoding` option below.
 */
const STREAM_SAMPLE_RATE = 16_000;
const STREAM_CHANNELS = 1;

function sessionIdFromRoomName(roomName: string | undefined): string | null {
  if (!roomName || !roomName.startsWith(WORKSHOP_ROOM_PREFIX)) return null;
  return roomName.slice(WORKSHOP_ROOM_PREFIX.length);
}

/**
 * Subscribes to one facilitator's audio track, streams it to Deepgram via
 * the same `SpeechToTextProvider.openStream` boundary the browser mic path
 * uses (`LiveCaptionStream`/`/api/captions/stream`), and publishes final
 * transcripts through `publishTranslatedCaption` directly — this worker runs
 * in the same process as the rest of the app now, so there's no HTTP hop.
 */
async function streamFacilitatorAudio(
  track: RemoteAudioTrack,
  sessionId: string,
  sourceLanguage: SupportedLanguage,
  translationMode: "AUTO" | "LOCAL_ONLY",
  activeTracks: Map<string, RemoteAudioTrack>,
  identity: string,
) {
  if (!speechToTextProvider.openStream) {
    console.warn(`[caption-agent] STT provider has no streaming support; not capturing session ${sessionId}.`);
    return;
  }
  // A network blip/reconnect can republish the facilitator's audio track under the
  // same identity before the old track's `TrackUnsubscribed` has cleared this guard
  // (see the RoomEvent.TrackUnsubscribed handler in `entry` below, which is what
  // actually clears it — not this loop's own completion, which can lag behind the
  // room-level unsubscribe signal), so `RoomEvent.TrackSubscribed` can arrive twice
  // for one facilitator. Without this guard both would open their own Deepgram
  // stream and publish for the same session, duplicating/interleaving transcript
  // segments — the caption pipeline has no de-duplication.
  if (activeTracks.has(identity)) {
    console.warn(`[caption-agent] Track already streaming for ${identity} in session ${sessionId}; skipping duplicate subscription.`);
    return;
  }
  activeTracks.set(identity, track);
  // Surfaced to the facilitator dashboard (see caption-source-state.ts) so it can
  // hide/disable the redundant "Start live captions from mic" button — that button
  // opens a second, independent STT pipeline for the same facilitator audio, which
  // was silently duplicating every caption (issue #95).
  await markCaptionAgentCapturing(sessionId);

  let segmentStartedAt = new Date();
  const sttStream = speechToTextProvider.openStream({
    expectedLanguage: sourceLanguage,
    encoding: { format: "linear16", sampleRate: STREAM_SAMPLE_RATE, channels: STREAM_CHANNELS },
    allowCloudFallback: translationMode !== "LOCAL_ONLY",
    onSegment: (event) => {
      if (!event.isFinal) return;
      // Capture and advance synchronously — see the matching comment in
      // src/app/api/captions/stream/route.ts for why reassigning inside a
      // post-publish `.finally()` races on back-to-back final segments.
      const startedAt = segmentStartedAt;
      const endedAt = new Date();
      segmentStartedAt = endedAt;
      void (async () => {
        const session = await prisma.session.findUnique({ where: { id: sessionId } });
        if (!session || session.status !== SessionStatus.LIVE) return;
        await publishTranslatedCaption(session, {
          speakerId: "Facilitator",
          originalText: event.text,
          // The freshly-refetched session's language, not the `sourceLanguage` this
          // stream was opened with — a facilitator can change their session's source
          // language mid-LIVE-session (updateFacilitatorLanguage), and this stream
          // (opened once, at subscribe time, and not restarted on that change) would
          // otherwise keep stamping every caption with the stale language for the
          // rest of the session even after the change.
          language: session.sourceLanguage as SupportedLanguage,
          startedAt,
          endedAt,
        });
      })();
    },
    onError: (error) => console.error(`[caption-agent] Deepgram stream error for ${sessionId}:`, error),
  });

  const audioStream = new AudioStream(track, STREAM_SAMPLE_RATE, STREAM_CHANNELS);
  try {
    for await (const frame of audioStream) {
      sttStream.sendAudio(new Uint8Array(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength));
    }
  } catch (error) {
    // Without this, an error thrown mid-stream (a dropped LiveKit connection, a
    // malformed frame) becomes an unhandled promise rejection from the `void
    // streamFacilitatorAudio(...)` call site below — silent in production, where
    // Node only logs unhandled rejections at a debug level most deployments don't
    // capture.
    console.error(`[caption-agent] audio stream error for ${sessionId}:`, error);
  } finally {
    sttStream.close();
    // Only clear this identity's guard if `track` is still the one on record — a
    // `TrackUnsubscribed`-triggered clear (or a newer `TrackSubscribed` superseding
    // it) may have already happened for a *different* track under this same
    // identity between this loop ending and this `finally` running; blindly
    // deleting here could otherwise clobber a newer, still-active stream's guard.
    if (activeTracks.get(identity) === track) activeTracks.delete(identity);
    await clearCaptionAgentCapturing(sessionId);
  }
}

/**
 * LiveKit Agents entrypoint — subscribes to the facilitator's audio track
 * server-side so captions work without the facilitator opening the mic
 * control in their browser. See `docs/TRANSLATION_ARCHITECTURE.md` Part 2.
 * Registered from `server.ts` in the same process as the rest of the app.
 */
export default defineAgent({
  entry: async (ctx: JobContext) => {
    const sessionId = sessionIdFromRoomName(ctx.room.name);
    if (!sessionId) {
      console.warn(`[caption-agent] Room name "${ctx.room.name}" doesn't match "workshop-<sessionId>"; skipping.`);
      return;
    }

    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session || session.status !== SessionStatus.LIVE) {
      console.warn(`[caption-agent] Session ${sessionId} is not live; skipping.`);
      return;
    }

    await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY);

    // Scoped to this job/room (one `entry` call per room), so this never leaks
    // state across sessions — see the guard inside streamFacilitatorAudio.
    const activeTracks = new Map<string, RemoteAudioTrack>();
    ctx.room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _publication, participant: RemoteParticipant) => {
      if (!(track instanceof RemoteAudioTrack)) return;
      if (!participant.identity.startsWith(FACILITATOR_IDENTITY_PREFIX)) return;
      void streamFacilitatorAudio(
        track,
        sessionId,
        session.sourceLanguage as SupportedLanguage,
        session.translationMode,
        activeTracks,
        participant.identity,
      );
    });
    // Proactively frees the per-identity guard as soon as LiveKit signals the old
    // track is gone, rather than waiting for that track's own audio-frame loop to
    // notice (which can lag behind this room-level event) — without this, a fast
    // reconnect's new `TrackSubscribed` can arrive while the guard is still (stale)
    // held by the old track, and get silently, permanently dropped by the guard in
    // streamFacilitatorAudio, killing captions for that facilitator for the rest of
    // the session with no retry.
    ctx.room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _publication, participant: RemoteParticipant) => {
      if (!(track instanceof RemoteAudioTrack)) return;
      if (!participant.identity.startsWith(FACILITATOR_IDENTITY_PREFIX)) return;
      if (activeTracks.get(participant.identity) === track) activeTracks.delete(participant.identity);
    });
  },
});
