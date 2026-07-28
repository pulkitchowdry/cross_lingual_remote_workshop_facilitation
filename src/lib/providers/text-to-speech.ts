import type { SupportedLanguage } from "@/lib/session-contracts";
import { isLocalInferenceConfigured, localSynthesize } from "@/lib/providers/local-inference-client";

export interface SynthesizedSpeech {
  audio: Uint8Array;
  mimeType: string;
  provider: string;
}

/** Raw 16-bit PCM samples normalized out of a `SynthesizedSpeech.audio` buffer,
 * ready to feed a LiveKit `AudioSource`/`AudioFrame` — see `toPcmSamples`. */
export interface PcmAudio {
  samples: Int16Array;
  sampleRate: number;
  channels: number;
}

/** Copies a byte range into a fresh, zero-offset buffer before viewing it as
 * `Int16Array` — `Uint8Array.prototype.slice` always allocates a new
 * `ArrayBuffer` starting at offset 0, sidestepping `Int16Array`'s requirement
 * that its backing buffer's offset be even (a raw `.subarray`/view here could
 * violate that depending on where the chunk happened to fall in the original
 * buffer). Assumes little-endian, matching every Node deployment target this
 * app runs on and the little-endian PCM data both tiers below produce. */
function readInt16LE(bytes: Uint8Array, byteOffset: number, byteLength: number): Int16Array {
  const evenLength = byteLength - (byteLength % 2);
  const aligned = bytes.slice(byteOffset, byteOffset + evenLength);
  return new Int16Array(aligned.buffer);
}

const RIFF_TAG = 0x52494646; // "RIFF"
const WAVE_TAG = 0x57415645; // "WAVE"
const FMT_TAG = 0x666d7420; // "fmt "
const DATA_TAG = 0x64617461; // "data"

/** Walks a WAV/RIFF container's chunks to find `fmt ` (sample rate/channel
 * count) and `data` (the actual PCM payload) — deliberately not a hardcoded
 * 44-byte header offset: Python's stdlib `wave` module (what Piper's tier
 * writes through, see `local-inference/app/models/piper.py`) is free to emit
 * additional chunks before `data`, and chunks are word-aligned (an odd-sized
 * chunk is followed by one padding byte), which this walk accounts for. */
function parseWav(bytes: Uint8Array): PcmAudio {
  if (bytes.byteLength < 12) throw new Error("toPcmSamples: buffer too short to be a WAV file.");
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (header.getUint32(0, false) !== RIFF_TAG || header.getUint32(8, false) !== WAVE_TAG) {
    throw new Error("toPcmSamples: not a valid RIFF/WAVE buffer.");
  }

  let offset = 12;
  let sampleRate: number | undefined;
  let channels: number | undefined;
  let dataOffset: number | undefined;
  let dataLength: number | undefined;
  while (offset + 8 <= bytes.byteLength) {
    const chunkId = header.getUint32(offset, false);
    const chunkSize = header.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    if (chunkId === FMT_TAG) {
      channels = header.getUint16(chunkStart + 2, true);
      sampleRate = header.getUint32(chunkStart + 4, true);
    } else if (chunkId === DATA_TAG) {
      dataOffset = chunkStart;
      dataLength = chunkSize;
    }
    offset = chunkStart + chunkSize + (chunkSize % 2);
  }
  if (sampleRate === undefined || channels === undefined || dataOffset === undefined || dataLength === undefined) {
    throw new Error("toPcmSamples: WAV buffer is missing a fmt or data chunk.");
  }
  return { samples: readInt16LE(bytes, dataOffset, dataLength), sampleRate, channels };
}

/**
 * Normalizes a `TextToSpeechProvider.synthesize()` result into raw 16-bit PCM
 * — the shape `LocalAudioTrack`/`AudioSource.captureFrame()` needs, per
 * `src/lib/providers/dub-audio-publisher.ts`. Every tier's `SynthesizedSpeech.audio`
 * is a real WAV container by the time it reaches here (Piper's own output
 * already is one; `synthesizeWithElevenLabs` below wraps its raw-PCM response
 * in one too), so this is just WAV parsing — no separate "headerless raw PCM"
 * branch, which keeps this contract uniform for every caller (this module's
 * own audio route also returns `SynthesizedSpeech.audio` straight to a
 * browser `<audio>` tag, which needs a real self-describing container, not
 * bare PCM bytes).
 */
export function toPcmSamples(audio: Uint8Array): PcmAudio {
  return parseWav(audio);
}

const WAV_HEADER_BYTES = 44;

/** Wraps headerless 16-bit PCM in a minimal canonical WAV container (the same
 * shape Python's `wave` module produces for Piper's tier) so `SynthesizedSpeech`
 * stays one uniform format regardless of tier — see `toPcmSamples`' doc comment. */
function wrapPcmAsWav(pcm: Uint8Array, sampleRate: number, channels: number): Uint8Array {
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + pcm.byteLength);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, tag: string) => {
    for (let i = 0; i < tag.length; i++) view.setUint8(offset + i, tag.charCodeAt(i));
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size (PCM)
  view.setUint16(20, 1, true); // audio format: 1 = PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true); // bits per sample
  writeAscii(36, "data");
  view.setUint32(40, pcm.byteLength, true);
  new Uint8Array(buffer, WAV_HEADER_BYTES).set(pcm);
  return new Uint8Array(buffer);
}

/** Sample rate requested from ElevenLabs' `output_format=pcm_<rate>` param
 * below — one of the fixed set of rates its API supports for raw PCM output.
 * Doesn't need to match Piper's own (fixed, model-determined) output rate:
 * `dub-audio-publisher.ts` resamples either tier to its track's configured
 * rate via `@livekit/rtc-node`'s `AudioResampler` when they differ, so this
 * is just a reasonable quality default, not a hard constraint. */
export const ELEVENLABS_PCM_SAMPLE_RATE = 24_000;

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

  // Requests headerless raw PCM directly (`output_format`, a query param, not a body
  // field) instead of MP3 — this app has no MP3 decoder anywhere, and the dub-audio
  // pipeline (`dub-audio-publisher.ts`) needs raw 16-bit PCM samples to feed a LiveKit
  // `AudioSource`. Wrapped back into a WAV container below (`wrapPcmAsWav`) before
  // returning, so `SynthesizedSpeech` stays one uniform, self-describing format
  // regardless of tier — see `toPcmSamples`' doc comment for why that matters.
  const params = new URLSearchParams({ output_format: `pcm_${ELEVENLABS_PCM_SAMPLE_RATE}` });
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}?${params.toString()}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text, model_id: ELEVENLABS_MODEL }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) {
    throw new Error(`ElevenLabs speech synthesis failed with status ${response.status}.`);
  }

  const pcm = new Uint8Array(await response.arrayBuffer());
  if (pcm.byteLength === 0) return null;

  return { audio: wrapPcmAsWav(pcm, ELEVENLABS_PCM_SAMPLE_RATE, 1), mimeType: "audio/wav", provider: "elevenlabs" };
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
