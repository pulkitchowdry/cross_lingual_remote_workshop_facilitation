import { WebSocket } from "ws";
import type { SupportedLanguage } from "@/lib/session-contracts";
import { isLocalInferenceConfigured, localTranscribe } from "@/lib/providers/local-inference-client";
import { LocalBufferingSpeechToTextStream } from "@/lib/providers/local-speech-buffer";

export interface TranscriptSegmentDraft {
  speakerId: string | null;
  originalText: string;
  language: SupportedLanguage;
  startedAt: Date;
  endedAt: Date;
  isFinal: boolean;
}

export interface StreamingTranscriptEvent {
  text: string;
  isFinal: boolean;
}

/** A live transcription session: push audio in, get transcript events out. */
export interface SpeechToTextStream {
  sendAudio(chunk: Uint8Array): void;
  close(): void;
}

interface TranscribeChunkInput {
  audio: Uint8Array;
  mimeType: string;
  expectedLanguage: SupportedLanguage;
  speakerId: string | null;
  /** Disables the cloud fallback tier for this call — a session's strict-privacy mode. Defaults to true. */
  allowCloudFallback?: boolean;
}

interface OpenStreamInput {
  expectedLanguage: SupportedLanguage;
  onSegment: (event: StreamingTranscriptEvent) => void;
  onError: (error: Error) => void;
  /**
   * Explicit PCM framing for callers that send raw, uncontainerized audio
   * (e.g. the LiveKit Agents worker, which resamples track audio to a known
   * rate/channel count). Omit for containerized audio (e.g. a browser's
   * WebM/Opus `MediaRecorder` chunks), which Deepgram auto-detects and the
   * local tier's buffering class ships as-is.
   */
  encoding?: { format: "linear16"; sampleRate: number; channels: number };
  /** Disables the cloud fallback tier for this call — a session's strict-privacy mode. Defaults to true. */
  allowCloudFallback?: boolean;
}

/**
 * Server-only boundary for streaming speech-to-text. Call sites must depend
 * on `SpeechToTextProvider`, never on a vendor SDK directly, so the STT
 * vendor/tier can change without touching call sites.
 */
export interface SpeechToTextProvider {
  readonly isConfigured: boolean;
  /**
   * Transcribes a single already-recorded audio chunk into a final segment.
   * Used for one-shot chunk transcription (e.g. a full pre-recorded clip).
   */
  transcribeChunk(input: TranscribeChunkInput): Promise<TranscriptSegmentDraft>;
  /**
   * Opens a live streaming transcription session for real-time interim/final
   * transcripts. Only present when at least one streaming-capable tier
   * (local-inference or Deepgram) is configured — omitted entirely otherwise,
   * matching the pre-tiering mock provider's contract, so callers can use
   * `speechToTextProvider.openStream` presence to gate streaming UI/routes.
   */
  openStream?(input: OpenStreamInput): SpeechToTextStream;
}

/**
 * Deterministic stand-in used until any STT tier is configured, so the rest
 * of the transcript/translation pipeline can be developed and tested without
 * a live provider.
 */
async function mockTranscribeChunk(input: TranscribeChunkInput): Promise<TranscriptSegmentDraft> {
  const now = new Date();
  return {
    speakerId: input.speakerId,
    originalText: "[mock transcription — configure LOCAL_INFERENCE_URL or STT_API_KEY for live speech-to-text]",
    language: input.expectedLanguage,
    startedAt: now,
    endedAt: now,
    isFinal: true,
  };
}

async function transcribeChunkLocally(input: TranscribeChunkInput): Promise<TranscriptSegmentDraft> {
  const startedAt = new Date();
  const { text } = await localTranscribe(input.audio, input.mimeType, input.expectedLanguage);
  const endedAt = new Date();
  return {
    speakerId: input.speakerId,
    originalText: text,
    language: input.expectedLanguage,
    startedAt,
    endedAt,
    isFinal: true,
  };
}

const DEEPGRAM_MODEL = "nova-3";

/** Minimal slice of Deepgram's prerecorded-transcription response shape. */
interface DeepgramListenResponse {
  results?: {
    channels?: Array<{
      alternatives?: Array<{ transcript?: string }>;
    }>;
  };
}

async function transcribeChunkWithDeepgram(input: TranscribeChunkInput): Promise<TranscriptSegmentDraft> {
  const apiKey = process.env.STT_API_KEY;
  if (!apiKey) {
    throw new Error("Deepgram is not configured: STT_API_KEY is missing.");
  }

  const startedAt = new Date();
  const params = new URLSearchParams({
    model: DEEPGRAM_MODEL,
    language: input.expectedLanguage,
    smart_format: "true",
    punctuate: "true",
  });

  const response = await fetch(`https://api.deepgram.com/v1/listen?${params.toString()}`, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": input.mimeType,
    },
    body: new Blob([new Uint8Array(input.audio)]),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) {
    throw new Error(`Deepgram transcription failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as DeepgramListenResponse;
  const transcript = payload.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";
  const endedAt = new Date();

  return {
    speakerId: input.speakerId,
    originalText: transcript,
    language: input.expectedLanguage,
    startedAt,
    endedAt,
    isFinal: true,
  };
}

/**
 * Tries the self-hosted faster-whisper tier first, then falls back to
 * Deepgram on any local failure, unless `allowCloudFallback: false` (a
 * session's strict-privacy mode) — matching the same policy as
 * `translateText`/`synthesizeSpeech`. Falls through to the mock draft only
 * when no tier is configured at all.
 */
async function transcribeChunk(input: TranscribeChunkInput): Promise<TranscriptSegmentDraft> {
  const allowCloudFallback = input.allowCloudFallback ?? true;
  const cloudConfigured = Boolean(process.env.STT_API_KEY);

  if (isLocalInferenceConfigured()) {
    try {
      return await transcribeChunkLocally(input);
    } catch (error) {
      if (!allowCloudFallback) throw error instanceof Error ? error : new Error(String(error));
      // Fall through to the cloud tier below.
    }
  } else if (!allowCloudFallback && cloudConfigured) {
    throw new Error("Local speech-to-text is not configured and cloud fallback is disabled for this session.");
  }

  if (cloudConfigured) return transcribeChunkWithDeepgram(input);
  return mockTranscribeChunk(input);
}

function openDeepgramStream(input: OpenStreamInput): SpeechToTextStream {
  const apiKey = process.env.STT_API_KEY;
  if (!apiKey) {
    throw new Error("Deepgram is not configured: STT_API_KEY is missing.");
  }
  return new DeepgramStreamingSession(apiKey, input.expectedLanguage, input.onSegment, input.onError, input.encoding);
}

/**
 * Opens a streaming session on whichever tier is configured. When
 * local-inference is configured, this is always a `LocalBufferingSpeechToTextStream`
 * (chunked, not true streaming — see that class's doc comment) with Deepgram
 * wired in as its lazy, sticky fallback factory; otherwise it opens a
 * Deepgram streaming session directly, matching pre-tiering behavior.
 */
function openStream(input: OpenStreamInput): SpeechToTextStream {
  const allowCloudFallback = input.allowCloudFallback ?? true;

  if (isLocalInferenceConfigured()) {
    return new LocalBufferingSpeechToTextStream({
      expectedLanguage: input.expectedLanguage,
      onSegment: input.onSegment,
      onError: input.onError,
      encoding: input.encoding,
      allowCloudFallback,
      openCloudFallback: () => openDeepgramStream(input),
    });
  }

  if (!allowCloudFallback) {
    throw new Error("Local caption service is not configured and cloud fallback is disabled for this session.");
  }
  return openDeepgramStream(input);
}

/** Minimal slice of Deepgram's live-streaming `Results` message shape. */
interface DeepgramStreamingMessage {
  type?: string;
  is_final?: boolean;
  channel?: {
    alternatives?: Array<{ transcript?: string }>;
  };
}

/**
 * Parses one Deepgram websocket message into a transcript event, or `null`
 * for messages that aren't a transcript (e.g. `Metadata`, `UtteranceEnd`) or
 * carry no text (interim silence). Extracted as a pure function so the
 * websocket wiring around it doesn't need a live connection to test.
 */
export function parseDeepgramStreamingMessage(raw: string): StreamingTranscriptEvent | null {
  let message: DeepgramStreamingMessage;
  try {
    message = JSON.parse(raw) as DeepgramStreamingMessage;
  } catch {
    return null;
  }
  if (message.type !== "Results") return null;

  const text = message.channel?.alternatives?.[0]?.transcript?.trim();
  if (!text) return null;

  return { text, isFinal: Boolean(message.is_final) };
}

/** How long to wait for Deepgram's TCP+TLS+WS handshake before giving up and
 * reporting an error — see the `connectTimeout` comment below for why this
 * exists at all. */
const DEEPGRAM_CONNECT_TIMEOUT_MS = 10_000;

class DeepgramStreamingSession implements SpeechToTextStream {
  private readonly socket: WebSocket;
  /** Set before we initiate our own close, so the `close` handler below can tell "we hung up" apart from Deepgram's side closing on us. */
  private closedByUs = false;

  constructor(
    apiKey: string,
    expectedLanguage: SupportedLanguage,
    onSegment: (event: StreamingTranscriptEvent) => void,
    onError: (error: Error) => void,
    encoding?: { format: "linear16"; sampleRate: number; channels: number },
  ) {
    const params = new URLSearchParams({
      model: DEEPGRAM_MODEL,
      language: expectedLanguage,
      smart_format: "true",
      punctuate: "true",
      interim_results: "true",
    });
    if (encoding) {
      params.set("encoding", encoding.format);
      params.set("sample_rate", String(encoding.sampleRate));
      params.set("channels", String(encoding.channels));
    }
    this.socket = new WebSocket(`wss://api.deepgram.com/v1/listen?${params.toString()}`, {
      headers: { Authorization: `Token ${apiKey}` },
    });
    // A network path that silently drops outbound packets instead of actively
    // rejecting them (a common failure mode for a restrictive VPN/proxy/firewall,
    // as opposed to one that resets the connection) never fires the socket's
    // `error` or `close` events at all — Node's own TCP connect timeout is
    // OS-dependent and can be well over a minute. Without this, that hang is
    // completely silent: the browser's WS to `/api/captions/stream` already
    // opened fine, so LiveCaptionStream.tsx shows "streaming" indefinitely with
    // no captions ever arriving and no error to explain why, which is strictly
    // worse than a wrong error — the facilitator has nothing to act on at all.
    const connectTimeout = setTimeout(() => {
      if (this.socket.readyState !== WebSocket.CONNECTING) return;
      onError(new Error(`Timed out connecting to the live caption service after ${DEEPGRAM_CONNECT_TIMEOUT_MS / 1000}s.`));
      this.closedByUs = true;
      this.socket.terminate();
    }, DEEPGRAM_CONNECT_TIMEOUT_MS);
    this.socket.on("open", () => clearTimeout(connectTimeout));
    this.socket.on("message", (data) => {
      const event = parseDeepgramStreamingMessage(data.toString());
      if (event) onSegment(event);
    });
    this.socket.on("error", (error) => {
      clearTimeout(connectTimeout);
      onError(error instanceof Error ? error : new Error(String(error)));
    });
    // Without this, a *clean* close (Deepgram's own idle timeout, its max-duration
    // limit, or an intermediate proxy/load balancer dropping an idle connection —
    // none of which raise a websocket "error") is invisible: `sendAudio` silently
    // no-ops once `readyState` leaves OPEN, `onError` never fires, and neither
    // caller (captions-socket.ts nor caption-agent.ts) has any other signal to
    // reconnect on — live captions would go silently dead mid-session with the UI
    // still reporting "streaming".
    this.socket.on("close", (code, reason) => {
      clearTimeout(connectTimeout);
      if (this.closedByUs) return;
      onError(new Error(`Deepgram streaming connection closed unexpectedly (code ${code}${reason.length > 0 ? `: ${reason.toString()}` : ""}).`));
    });
  }

  sendAudio(chunk: Uint8Array): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(chunk);
  }

  close(): void {
    this.closedByUs = true;
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.close();
    }
  }
}

function createSpeechToTextProvider(): SpeechToTextProvider {
  const streamingConfigured = isLocalInferenceConfigured() || Boolean(process.env.STT_API_KEY);

  const provider: SpeechToTextProvider = {
    get isConfigured() {
      return isLocalInferenceConfigured() || Boolean(process.env.STT_API_KEY);
    },
    transcribeChunk,
  };

  // Matches the pre-tiering mock provider's contract: `openStream` is entirely
  // absent (not just throwing) when no streaming-capable tier is configured,
  // so callers can gate streaming UI/routes on its presence.
  if (streamingConfigured) {
    provider.openStream = openStream;
  }

  return provider;
}

export const speechToTextProvider: SpeechToTextProvider = createSpeechToTextProvider();
