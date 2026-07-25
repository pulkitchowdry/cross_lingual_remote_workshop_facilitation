import type { SupportedLanguage } from "@/lib/session-contracts";
import { isLocalInferenceConfigured, localSynthesize } from "@/lib/providers/local-inference-client";

export interface SynthesizedSpeech {
  audio: Uint8Array;
  mimeType: string;
  provider: string;
}

/** ElevenLabs voice IDs per supported language — multilingual model, language-appropriate default voice. */
const ELEVENLABS_VOICE_BY_LANGUAGE: Record<SupportedLanguage, string> = {
  en: "21m00Tcm4TlvDq8ikWAM", // Rachel
  zh: "TxGEqnHWrfWFTfGW9XjX", // Josh (multilingual model handles zh)
  es: "TxGEqnHWrfWFTfGW9XjX",
};

const ELEVENLABS_MODEL = "eleven_multilingual_v2";

/**
 * Cloud fallback tier. Unlike translation's degrade-to-null contract, this
 * throws on failure — callers (the on-demand audio route) already convert a
 * thrown error into an HTTP 502, and that contract is preserved deliberately
 * rather than reconciled with translation's null-degrade convention.
 */
async function synthesizeWithElevenLabs(text: string, language: SupportedLanguage): Promise<SynthesizedSpeech | null> {
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
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) {
    throw new Error(`ElevenLabs speech synthesis failed with status ${response.status}.`);
  }

  const audio = new Uint8Array(await response.arrayBuffer());
  if (audio.byteLength === 0) return null;

  return { audio, mimeType: "audio/mpeg", provider: "elevenlabs" };
}

/**
 * Tries the self-hosted Piper tier first, then falls back to ElevenLabs on
 * any local failure, unless the caller passes `allowCloudFallback: false`
 * (a session's strict-privacy mode), in which case a local failure throws
 * immediately — same "surface as unavailable, don't call out" behavior as
 * disallowing translation's cloud fallback.
 */
async function synthesizeSpeech(
  text: string,
  language: SupportedLanguage,
  options?: { allowCloudFallback?: boolean },
): Promise<SynthesizedSpeech | null> {
  const allowCloudFallback = options?.allowCloudFallback ?? true;
  const cloudConfigured = Boolean(process.env.TTS_API_KEY);

  if (isLocalInferenceConfigured()) {
    try {
      const { audio, mimeType } = await localSynthesize(text, language);
      return { audio, mimeType, provider: "piper" };
    } catch (error) {
      if (!allowCloudFallback) {
        throw error instanceof Error ? error : new Error(String(error));
      }
      // Fall through to the cloud tier below.
    }
  } else if (!allowCloudFallback) {
    if (cloudConfigured) {
      throw new Error("Local text-to-speech is not configured and cloud fallback is disabled for this session.");
    }
    return null; // Nothing configured at all — matches the pre-tiering mock's always-null contract.
  }

  if (!cloudConfigured) return null; // No cloud tier to fall back to — matches the mock's always-null contract.
  return synthesizeWithElevenLabs(text, language);
}

/**
 * Server-only boundary for opt-in text-to-speech — Part 3 of
 * `docs/TRANSLATION_ARCHITECTURE.md`. Call sites must depend on
 * `TextToSpeechProvider`, never on a vendor SDK directly, so the TTS vendor
 * can change without touching call sites.
 */
export interface TextToSpeechProvider {
  readonly isConfigured: boolean;
  synthesize(
    text: string,
    language: SupportedLanguage,
    options?: { allowCloudFallback?: boolean },
  ): Promise<SynthesizedSpeech | null>;
}

export const textToSpeechProvider: TextToSpeechProvider = {
  get isConfigured() {
    return Boolean(process.env.TTS_API_KEY) || isLocalInferenceConfigured();
  },
  synthesize: synthesizeSpeech,
};
