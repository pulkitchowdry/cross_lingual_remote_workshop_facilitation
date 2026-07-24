import type { SupportedLanguage } from "@/lib/session-contracts";

export interface SynthesizedSpeech {
  audio: Uint8Array;
  mimeType: string;
  provider: string;
}

/**
 * Server-only boundary for opt-in text-to-speech — Part 3 of
 * `docs/TRANSLATION_ARCHITECTURE.md`. Call sites must depend on
 * `TextToSpeechProvider`, never on a vendor SDK directly, so the TTS vendor
 * can change without touching call sites.
 */
export interface TextToSpeechProvider {
  readonly isConfigured: boolean;
  synthesize(text: string, language: SupportedLanguage): Promise<SynthesizedSpeech | null>;
}

/**
 * No-op until `TTS_API_KEY` is configured — voice output is opt-in and
 * additive (see the doc's Part 3), so the rest of the app must work with
 * this returning `null` for every request.
 */
class MockTextToSpeechProvider implements TextToSpeechProvider {
  readonly isConfigured = false;

  async synthesize(): Promise<SynthesizedSpeech | null> {
    return null;
  }
}

/** ElevenLabs voice IDs per supported language — multilingual model, language-appropriate default voice. */
const ELEVENLABS_VOICE_BY_LANGUAGE: Record<SupportedLanguage, string> = {
  en: "21m00Tcm4TlvDq8ikWAM", // Rachel
  zh: "TxGEqnHWrfWFTfGW9XjX", // Josh (multilingual model handles zh)
  es: "TxGEqnHWrfWFTfGW9XjX",
};

const ELEVENLABS_MODEL = "eleven_multilingual_v2";

/**
 * Managed TTS adapter. The doc's Part 3 names Piper (self-hosted) as the
 * default for cost/privacy reasons; this ships the managed path first since
 * Piper needs a self-hosted model server this repo doesn't run anywhere.
 * A self-hosted `PiperTextToSpeechProvider` can be added behind this same
 * interface without touching call sites.
 */
class ElevenLabsTextToSpeechProvider implements TextToSpeechProvider {
  get isConfigured() {
    return Boolean(process.env.TTS_API_KEY);
  }

  async synthesize(text: string, language: SupportedLanguage): Promise<SynthesizedSpeech | null> {
    const apiKey = process.env.TTS_API_KEY;
    if (!apiKey) {
      throw new Error("ElevenLabs is not configured: TTS_API_KEY is missing.");
    }

    const voiceId = ELEVENLABS_VOICE_BY_LANGUAGE[language];
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({ text, model_id: ELEVENLABS_MODEL }),
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`ElevenLabs speech synthesis failed with status ${response.status}.`);
    }

    const audio = new Uint8Array(await response.arrayBuffer());
    if (audio.byteLength === 0) return null;

    return { audio, mimeType: "audio/mpeg", provider: "elevenlabs" };
  }
}

export const textToSpeechProvider: TextToSpeechProvider = process.env.TTS_API_KEY
  ? new ElevenLabsTextToSpeechProvider()
  : new MockTextToSpeechProvider();
