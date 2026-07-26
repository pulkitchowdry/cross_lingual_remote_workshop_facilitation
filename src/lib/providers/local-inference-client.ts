import type { SupportedLanguage } from "@/lib/session-contracts";

/**
 * Thin HTTP client for the self-hosted `local-inference/` service (NLLB
 * translation / faster-whisper STT / Piper TTS) — see
 * `docs/TRANSLATION_ARCHITECTURE.md` Part 5. Every function here throws on
 * any failure (network, timeout, non-OK); callers own catch-and-fallback
 * semantics, matching the tiering pattern in `translation.ts`/
 * `speech-to-text.ts`/`text-to-speech.ts`.
 */

export function isLocalInferenceConfigured(): boolean {
  return Boolean(process.env.LOCAL_INFERENCE_URL && process.env.LOCAL_INFERENCE_SECRET);
}

function baseUrl(): string {
  const url = process.env.LOCAL_INFERENCE_URL;
  if (!url) throw new Error("local-inference is not configured: LOCAL_INFERENCE_URL is missing.");
  return url.replace(/\/$/, "");
}

function authHeaders(): Record<string, string> {
  const secret = process.env.LOCAL_INFERENCE_SECRET;
  if (!secret) throw new Error("local-inference is not configured: LOCAL_INFERENCE_SECRET is missing.");
  return { Authorization: `Bearer ${secret}` };
}

export async function localTranslate(
  text: string,
  sourceLanguage: SupportedLanguage,
  targetLanguage: SupportedLanguage,
): Promise<{ text: string }> {
  const response = await fetch(`${baseUrl()}/translate`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ text, sourceLanguage, targetLanguage }),
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`local-inference translate failed with status ${response.status}: ${detail || "no response body"}`);
  }
  const payload = (await response.json()) as { text?: string };
  if (typeof payload.text !== "string") throw new Error("local-inference translate returned no text.");
  return { text: payload.text };
}

export async function localTranscribe(
  audio: Uint8Array,
  mimeType: string,
  expectedLanguage: SupportedLanguage,
): Promise<{ text: string }> {
  const form = new FormData();
  form.set("audio", new Blob([new Uint8Array(audio)], { type: mimeType }), "audio");
  form.set("expectedLanguage", expectedLanguage);

  const response = await fetch(`${baseUrl()}/stt/transcribe`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`local-inference transcribe failed with status ${response.status}.`);
  const payload = (await response.json()) as { text?: string };
  if (typeof payload.text !== "string") throw new Error("local-inference transcribe returned no text.");
  return { text: payload.text };
}

export async function localSynthesize(
  text: string,
  language: SupportedLanguage,
): Promise<{ audio: Uint8Array; mimeType: string }> {
  const response = await fetch(`${baseUrl()}/tts/synthesize`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ text, language }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`local-inference synthesize failed with status ${response.status}.`);
  const audio = new Uint8Array(await response.arrayBuffer());
  if (audio.byteLength === 0) throw new Error("local-inference synthesize returned no audio.");
  return { audio, mimeType: "audio/wav" };
}
