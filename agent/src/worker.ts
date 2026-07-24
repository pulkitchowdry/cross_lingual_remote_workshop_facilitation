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

  async getSessionInfo(sessionId: string): Promise<{ isLive: boolean; sourceLanguage: SupportedLanguage } | null> {
    const response = await fetch(`${this.baseUrl}/api/captions/agent?sessionId=${encodeURIComponent(sessionId)}`, {
      headers: { "x-caption-agent-secret": this.secret },
    });
    if (!response.ok) return null;
    return (await response.json()) as { isLive: boolean; sourceLanguage: SupportedLanguage };
  }

  async publishCaption(input: { sessionId: string; originalText: string; startedAt: Date; endedAt: Date }): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/captions/agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-caption-agent-secret": this.secret },
      body: JSON.stringify({
        sessionId: input.sessionId,
        originalText: input.originalText,
        startedAt: input.startedAt.toISOString(),
        endedAt: input.endedAt.toISOString(),
      }),
    });
    if (!response.ok) {
      console.error(`[caption-agent] Publish failed with status ${response.status} for session ${input.sessionId}.`);
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
  client: CaptionAgentClient,
) {
  if (!speechToTextProvider.openStream) {
    console.warn(`[caption-agent] STT provider has no streaming support; not capturing session ${sessionId}.`);
    return;
  }

  let segmentStartedAt = new Date();
  const sttStream = speechToTextProvider.openStream({
    expectedLanguage: sourceLanguage,
    encoding: { format: "linear16", sampleRate: STREAM_SAMPLE_RATE, channels: STREAM_CHANNELS },
    onSegment: (event) => {
      if (!event.isFinal) return;
      const endedAt = new Date();
      void client
        .publishCaption({ sessionId, originalText: event.text, startedAt: segmentStartedAt, endedAt })
        .finally(() => {
          segmentStartedAt = new Date();
        });
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

    ctx.room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _publication, participant: RemoteParticipant) => {
      if (!(track instanceof RemoteAudioTrack)) return;
      if (!participant.identity.startsWith(FACILITATOR_IDENTITY_PREFIX)) return;
      void streamFacilitatorAudio(track, sessionId, info.sourceLanguage, client);
    });
  },
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url) }));
}
