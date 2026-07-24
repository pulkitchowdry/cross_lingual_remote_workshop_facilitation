import { WebSocket } from "ws";
import type { SupportedLanguage } from "@/lib/session-contracts";

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

/**
 * Server-only boundary for streaming speech-to-text. Call sites must depend
 * on `SpeechToTextProvider`, never on a vendor SDK directly, so the STT
 * vendor can change without touching call sites.
 */
export interface SpeechToTextProvider {
  readonly isConfigured: boolean;
  /**
   * Transcribes a single already-recorded audio chunk into a final segment.
   * Used for one-shot chunk transcription (e.g. a full pre-recorded clip).
   */
  transcribeChunk(input: {
    audio: Uint8Array;
    mimeType: string;
    expectedLanguage: SupportedLanguage;
    speakerId: string | null;
  }): Promise<TranscriptSegmentDraft>;
  /**
   * Opens a live streaming transcription session for real-time interim/final
   * transcripts, matching the doc's "true low-latency streaming STT" design.
   * Optional — only implemented by providers with a real streaming API; the
   * mock provider omits it.
   */
  openStream?(input: {
    expectedLanguage: SupportedLanguage;
    onSegment: (event: StreamingTranscriptEvent) => void;
    onError: (error: Error) => void;
  }): SpeechToTextStream;
}

/**
 * Deterministic stand-in used until `STT_API_KEY` is configured, so the rest
 * of the transcript/translation pipeline can be developed and tested without
 * a live provider. Never used when `isConfigured` is false in a code path
 * that requires real transcription.
 */
class MockSpeechToTextProvider implements SpeechToTextProvider {
  readonly isConfigured = false;

  async transcribeChunk(input: {
    audio: Uint8Array;
    mimeType: string;
    expectedLanguage: SupportedLanguage;
    speakerId: string | null;
  }): Promise<TranscriptSegmentDraft> {
    const now = new Date();
    return {
      speakerId: input.speakerId,
      originalText: "[mock transcription — configure STT_API_KEY for live speech-to-text]",
      language: input.expectedLanguage,
      startedAt: now,
      endedAt: now,
      isFinal: true,
    };
  }
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

/**
 * Deepgram adapter for `SpeechToTextProvider`. Uses the prerecorded `/listen`
 * endpoint per chunk (matching `transcribeChunk`'s "already-recorded audio
 * chunk" contract) rather than Deepgram's websocket streaming API, so it
 * fits the same request/response server boundary as `translateText` without
 * requiring a long-lived connection. A future streaming adapter can replace
 * this class without touching call sites.
 */
class DeepgramSpeechToTextProvider implements SpeechToTextProvider {
  get isConfigured() {
    return Boolean(process.env.STT_API_KEY);
  }

  async transcribeChunk(input: {
    audio: Uint8Array;
    mimeType: string;
    expectedLanguage: SupportedLanguage;
    speakerId: string | null;
  }): Promise<TranscriptSegmentDraft> {
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

  openStream(input: {
    expectedLanguage: SupportedLanguage;
    onSegment: (event: StreamingTranscriptEvent) => void;
    onError: (error: Error) => void;
  }): SpeechToTextStream {
    const apiKey = process.env.STT_API_KEY;
    if (!apiKey) {
      throw new Error("Deepgram is not configured: STT_API_KEY is missing.");
    }
    return new DeepgramStreamingSession(apiKey, input.expectedLanguage, input.onSegment, input.onError);
  }
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

class DeepgramStreamingSession implements SpeechToTextStream {
  private readonly socket: WebSocket;

  constructor(
    apiKey: string,
    expectedLanguage: SupportedLanguage,
    onSegment: (event: StreamingTranscriptEvent) => void,
    onError: (error: Error) => void,
  ) {
    const params = new URLSearchParams({
      model: DEEPGRAM_MODEL,
      language: expectedLanguage,
      smart_format: "true",
      punctuate: "true",
      interim_results: "true",
    });
    this.socket = new WebSocket(`wss://api.deepgram.com/v1/listen?${params.toString()}`, {
      headers: { Authorization: `Token ${apiKey}` },
    });
    this.socket.on("message", (data) => {
      const event = parseDeepgramStreamingMessage(data.toString());
      if (event) onSegment(event);
    });
    this.socket.on("error", (error) => onError(error instanceof Error ? error : new Error(String(error))));
  }

  sendAudio(chunk: Uint8Array): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(chunk);
  }

  close(): void {
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.close();
    }
  }
}

export const speechToTextProvider: SpeechToTextProvider = process.env.STT_API_KEY
  ? new DeepgramSpeechToTextProvider()
  : new MockSpeechToTextProvider();
