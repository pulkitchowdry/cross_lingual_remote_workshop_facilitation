import type { SupportedLanguage } from "@/lib/session-contracts";

export interface TranscriptSegmentDraft {
  speakerId: string | null;
  originalText: string;
  language: SupportedLanguage;
  startedAt: Date;
  endedAt: Date;
  isFinal: boolean;
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
   * A streaming adapter would additionally expose interim segments; this
   * method models the minimum the transcript pipeline needs: durable final
   * segments per chunk.
   */
  transcribeChunk(input: {
    audio: Uint8Array;
    mimeType: string;
    expectedLanguage: SupportedLanguage;
    speakerId: string | null;
  }): Promise<TranscriptSegmentDraft>;
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
}

export const speechToTextProvider: SpeechToTextProvider = process.env.STT_API_KEY
  ? new DeepgramSpeechToTextProvider()
  : new MockSpeechToTextProvider();
