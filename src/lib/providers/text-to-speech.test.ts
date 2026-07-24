import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

function restoreEnv() {
  process.env = { ...ORIGINAL_ENV };
}

describe("textToSpeechProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    restoreEnv();
    vi.resetModules();
  });

  it("falls back to the mock provider when TTS_API_KEY is unset, always returning null", async () => {
    delete process.env.TTS_API_KEY;
    const { textToSpeechProvider } = await import("./text-to-speech");

    expect(textToSpeechProvider.isConfigured).toBe(false);
    await expect(textToSpeechProvider.synthesize("hello", "en")).resolves.toBeNull();
  });

  it("selects the ElevenLabs provider and returns audio bytes when TTS_API_KEY is set", async () => {
    process.env.TTS_API_KEY = "test-key";
    const audioBytes = new Uint8Array([1, 2, 3, 4]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => audioBytes.buffer,
    });
    vi.stubGlobal("fetch", fetchMock);

    const { textToSpeechProvider } = await import("./text-to-speech");
    expect(textToSpeechProvider.isConfigured).toBe(true);

    const result = await textToSpeechProvider.synthesize("hello", "en");
    expect(result).toEqual({ audio: audioBytes, mimeType: "audio/mpeg", provider: "elevenlabs" });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("https://api.elevenlabs.io/v1/text-to-speech/"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws when ElevenLabs responds with a non-OK status", async () => {
    process.env.TTS_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const { textToSpeechProvider } = await import("./text-to-speech");
    await expect(textToSpeechProvider.synthesize("hello", "en")).rejects.toThrow(/ElevenLabs speech synthesis failed/);
  });

  it("prefers the local-inference tier when configured, returning provider 'piper'", async () => {
    process.env.LOCAL_INFERENCE_URL = "https://local.example.com";
    process.env.LOCAL_INFERENCE_SECRET = "s3cret";
    delete process.env.TTS_API_KEY;
    const audioBytes = new Uint8Array([9, 9, 9]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => audioBytes.buffer }));

    const { textToSpeechProvider } = await import("./text-to-speech");
    expect(textToSpeechProvider.isConfigured).toBe(true);
    const result = await textToSpeechProvider.synthesize("hola", "es");
    expect(result).toEqual({ audio: audioBytes, mimeType: "audio/wav", provider: "piper" });
  });

  it("falls back to ElevenLabs when local-inference fails and cloud fallback is allowed", async () => {
    process.env.LOCAL_INFERENCE_URL = "https://local.example.com";
    process.env.LOCAL_INFERENCE_SECRET = "s3cret";
    process.env.TTS_API_KEY = "test-key";
    const audioBytes = new Uint8Array([1, 2, 3]);
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("local.example.com")) return { ok: false, status: 500 };
      return { ok: true, arrayBuffer: async () => audioBytes.buffer };
    });
    vi.stubGlobal("fetch", fetchMock);

    const { textToSpeechProvider } = await import("./text-to-speech");
    const result = await textToSpeechProvider.synthesize("hello", "en");
    expect(result).toEqual({ audio: audioBytes, mimeType: "audio/mpeg", provider: "elevenlabs" });
  });

  it("throws (never calling ElevenLabs) when local-inference fails and cloud fallback is disallowed", async () => {
    process.env.LOCAL_INFERENCE_URL = "https://local.example.com";
    process.env.LOCAL_INFERENCE_SECRET = "s3cret";
    process.env.TTS_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal("fetch", fetchMock);

    const { textToSpeechProvider } = await import("./text-to-speech");
    await expect(
      textToSpeechProvider.synthesize("hello", "en", { allowCloudFallback: false }),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
