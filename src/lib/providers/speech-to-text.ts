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
 * Server-only boundary for streaming speech-to-text. No live adapter (Deepgram,
 * Soniox, ...) is wired yet — Phase 1 replaces `MockSpeechToTextProvider` with a
 * real streaming implementation behind this same interface. Call sites must
 * depend on `SpeechToTextProvider`, never on a vendor SDK directly.
 */
export interface SpeechToTextProvider {
  readonly isConfigured: boolean;
  /**
   * Transcribes a single already-recorded audio chunk into a final segment.
   * A streaming adapter will additionally expose interim segments once wired;
   * this method models the minimum Phase 1 needs: durable final segments.
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

export const speechToTextProvider: SpeechToTextProvider = new MockSpeechToTextProvider();
