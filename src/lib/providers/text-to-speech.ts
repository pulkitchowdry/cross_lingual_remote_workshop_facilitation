import type { SupportedLanguage } from "@/lib/session-contracts";
import { isLocalInferenceConfigured, localSynthesize } from "@/lib/providers/local-inference-client";

export interface SynthesizedSpeech {
  audio: Uint8Array;
  mimeType: string;
  provider: string;
}

/**
 * One "premade" ElevenLabs voice for every language — Voice Library voices
 * require a paid plan to use via the API (a free-tier key gets a 402
 * `paid_plan_required`), but premade voices (the stock set every account
 * ships with) work on the free tier. `eleven_multilingual_v2` handles
 * English/Chinese/Spanish regardless of the voice's native accent, so one
 * voice ID covers all supported languages — no need to pick a different one
 * per language. See `GET /v1/voices` for the full list an account can use.
 */
const ELEVENLABS_VOICE_ID = "SAz9YHcvj6GT2YYXdXww"; // River — premade

const ELEVENLABS_MODEL = "eleven_multilingual_v2";

/**
 * Cloud fallback tier. Unlike translation's degrade-to-null contract, this
 * throws on failure — callers (the on-demand audio route) already convert a
 * thrown error into an HTTP 502, and that contract is preserved deliberately
 * rather than reconciled with translation's null-degrade convention.
 */
async function synthesizeWithElevenLabs(text: string): Promise<SynthesizedSpeech | null> {
  const apiKey = process.env.TTS_API_KEY;
  if (!apiKey) {
    throw new Error("ElevenLabs is not configured: TTS_API_KEY is missing.");
  }

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Matches translation.ts's LOCAL_TRANSLATE_ATTEMPTS/LOCAL_TRANSLATE_RETRY_DELAY_MS —
// one retry of the local tier before falling back, since a single transient
// timeout/network blip shouldn't immediately burn a paid ElevenLabs call the way an
// un-retried local failure used to.
const LOCAL_SYNTHESIZE_ATTEMPTS = 2;
const LOCAL_SYNTHESIZE_RETRY_DELAY_MS = 400;

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
    for (let attempt = 1; attempt <= LOCAL_SYNTHESIZE_ATTEMPTS; attempt++) {
      try {
        const { audio, mimeType } = await localSynthesize(text, language);
        return { audio, mimeType, provider: "piper" };
      } catch (error) {
        console.error(
          `[text-to-speech] local-inference synthesize attempt ${attempt}/${LOCAL_SYNTHESIZE_ATTEMPTS} failed:`,
          error,
        );
        if (attempt < LOCAL_SYNTHESIZE_ATTEMPTS) {
          await delay(LOCAL_SYNTHESIZE_RETRY_DELAY_MS);
          continue;
        }
        if (!allowCloudFallback) {
          throw error instanceof Error ? error : new Error(String(error));
        }
        // Last attempt exhausted, cloud fallback allowed: fall through to the cloud tier below.
      }
    }
  } else if (!allowCloudFallback) {
    if (cloudConfigured) {
      throw new Error("Local text-to-speech is not configured and cloud fallback is disabled for this session.");
    }
    return null; // Nothing configured at all — matches the pre-tiering mock's always-null contract.
  }

  if (!cloudConfigured) return null; // No cloud tier to fall back to — matches the mock's always-null contract.
  return synthesizeWithElevenLabs(text);
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
