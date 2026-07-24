import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_TTS_API_KEY = process.env.TTS_API_KEY;

describe("textToSpeechProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    if (ORIGINAL_TTS_API_KEY === undefined) delete process.env.TTS_API_KEY;
    else process.env.TTS_API_KEY = ORIGINAL_TTS_API_KEY;
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
});
