import "dotenv/config";
import { fileURLToPath } from "node:url";
import { AutoSubscribe, ServerOptions, cli, defineAgent, type JobContext } from "@livekit/agents";
import { AudioStream, RemoteAudioTrack, RoomEvent, type RemoteParticipant, type RemoteTrack } from "@livekit/rtc-node";
import { speechToTextProvider } from "../../src/lib/providers/speech-to-text.ts";
import type { SupportedLanguage } from "../../src/lib/session-contracts.ts";

const WORKSHOP_ROOM_PREFIX = "workshop-";
const FACILITATOR_IDENTITY_PREFIX = "facilitator:";
/**
 * Rate the agent asks LiveKit to resample the facilitator's track to before
 * handing frames to Deepgram — matches the `linear16` PCM framing passed to
 * `openStream`'s `encoding` option below.
 */
const STREAM_SAMPLE_RATE = 16_000;
const STREAM_CHANNELS = 1;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required to run the caption agent.`);
  return value;
}

function sessionIdFromRoomName(roomName: string | undefined): string | null {
  if (!roomName || !roomName.startsWith(WORKSHOP_ROOM_PREFIX)) return null;
  return roomName.slice(WORKSHOP_ROOM_PREFIX.length);
}

/**
 * Thin client for the Next.js app's `/api/captions/agent` endpoint — see the
 * comment on that route for why this worker talks to the app over HTTP
 * instead of importing `@/lib/db`/`@/lib/captions` directly (a first attempt
 * at direct Prisma-client import failed in local testing under tsx).
 */
class CaptionAgentClient {
  private readonly baseUrl: string;
  private readonly secret: string;

  constructor(baseUrl: string, secret: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.secret = secret;
  }

  async getSessionInfo(
    sessionId: string,
  ): Promise<{ isLive: boolean; sourceLanguage: SupportedLanguage; translationMode: "AUTO" | "LOCAL_ONLY" } | null> {
    const response = await fetch(`${this.baseUrl}/api/captions/agent?sessionId=${encodeURIComponent(sessionId)}`, {
      headers: { "x-caption-agent-secret": this.secret },
    });
    if (!response.ok) return null;
    return (await response.json()) as {
      isLive: boolean;
      sourceLanguage: SupportedLanguage;
      translationMode: "AUTO" | "LOCAL_ONLY";
    };
  }

  async publishCaption(input: { sessionId: string; originalText: string; startedAt: Date; endedAt: Date }): Promise<void> {
    const body = JSON.stringify({
      sessionId: input.sessionId,
      originalText: input.originalText,
      startedAt: input.startedAt.toISOString(),
      endedAt: input.endedAt.toISOString(),
    });
    const attempts = 3;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await fetch(`${this.baseUrl}/api/captions/agent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-caption-agent-secret": this.secret },
          body,
        });
        if (response.ok) return;
        if (attempt === attempts) {
          console.error(
            `[caption-agent] Publish failed with status ${response.status} for session ${input.sessionId} after ${attempts} attempts — segment lost.`,
          );
          return;
        }
      } catch (error) {
        if (attempt === attempts) {
          console.error(
            `[caption-agent] Publish threw for session ${input.sessionId} after ${attempts} attempts — segment lost.`,
            error,
          );
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 300));
    }
  }
}

/**
 * Subscribes to one facilitator's audio track, streams it to Deepgram via
 * the same `SpeechToTextProvider.openStream` boundary the browser mic path
 * uses (`LiveCaptionStream`/`/api/captions/stream`), and publishes final
 * transcripts through the app's caption API — so captions work without the
 * facilitator ever opening the mic control in their browser.
 */
async function streamFacilitatorAudio(
  track: RemoteAudioTrack,
  sessionId: string,
  sourceLanguage: SupportedLanguage,
  translationMode: "AUTO" | "LOCAL_ONLY",
  client: CaptionAgentClient,
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
  // Deepgram stream and `publishCaption` for the same session, duplicating/interleaving
  // transcript segments — the caption route has no de-duplication.
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
      void client.publishCaption({ sessionId, originalText: event.text, startedAt, endedAt });
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

export default defineAgent({
  entry: async (ctx: JobContext) => {
    const sessionId = sessionIdFromRoomName(ctx.room.name);
    if (!sessionId) {
      console.warn(`[caption-agent] Room name "${ctx.room.name}" doesn't match "workshop-<sessionId>"; skipping.`);
      return;
    }

    const client = new CaptionAgentClient(requireEnv("APP_BASE_URL"), requireEnv("CAPTION_AGENT_SECRET"));
    const info = await client.getSessionInfo(sessionId);
    if (!info?.isLive) {
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
        info.sourceLanguage,
        info.translationMode,
        client,
        activeIdentities,
        participant.identity,
      );
    });
  },
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url) }));
}
