import { AutoSubscribe, defineAgent, type JobContext } from "@livekit/agents";
import { AudioStream, RemoteAudioTrack, RoomEvent, type RemoteParticipant, type RemoteTrack } from "@livekit/rtc-node";
import { SessionStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { publishTranslatedCaption } from "@/lib/captions";
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
  activeIdentities: Set<string>,
  identity: string,
) {
  if (!speechToTextProvider.openStream) {
    console.warn(`[caption-agent] STT provider has no streaming support; not capturing session ${sessionId}.`);
    return;
  }
  // A network blip/reconnect can republish the facilitator's audio track under the
  // same identity before the old track's unsubscribe fires, so `RoomEvent.TrackSubscribed`
  // can arrive twice for one facilitator. Without this guard both would open their own
  // Deepgram stream and publish for the same session, duplicating/interleaving
  // transcript segments — the caption pipeline has no de-duplication.
  if (activeIdentities.has(identity)) {
    console.warn(`[caption-agent] Track already streaming for ${identity} in session ${sessionId}; skipping duplicate subscription.`);
    return;
  }
  activeIdentities.add(identity);

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
          language: sourceLanguage,
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
  } finally {
    sttStream.close();
    activeIdentities.delete(identity);
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
    const activeIdentities = new Set<string>();
    ctx.room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _publication, participant: RemoteParticipant) => {
      if (!(track instanceof RemoteAudioTrack)) return;
      if (!participant.identity.startsWith(FACILITATOR_IDENTITY_PREFIX)) return;
      void streamFacilitatorAudio(
        track,
        sessionId,
        session.sourceLanguage as SupportedLanguage,
        session.translationMode,
        activeIdentities,
        participant.identity,
      );
    });
  },
});
