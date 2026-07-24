import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_STT_API_KEY = process.env.STT_API_KEY;

describe("speechToTextProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    if (ORIGINAL_STT_API_KEY === undefined) delete process.env.STT_API_KEY;
    else process.env.STT_API_KEY = ORIGINAL_STT_API_KEY;
    vi.resetModules();
  });

  it("falls back to the mock provider when STT_API_KEY is unset", async () => {
    delete process.env.STT_API_KEY;
    const { speechToTextProvider } = await import("./speech-to-text");

    expect(speechToTextProvider.isConfigured).toBe(false);
    const draft = await speechToTextProvider.transcribeChunk({
      audio: new Uint8Array(),
      mimeType: "audio/webm",
      expectedLanguage: "en",
      speakerId: "Facilitator",
    });
    expect(draft.originalText).toContain("mock transcription");
  });

  it("selects the Deepgram provider and parses its transcript when STT_API_KEY is set", async () => {
    process.env.STT_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: { channels: [{ alternatives: [{ transcript: "hello from deepgram" }] }] },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { speechToTextProvider } = await import("./speech-to-text");
    expect(speechToTextProvider.isConfigured).toBe(true);

    const draft = await speechToTextProvider.transcribeChunk({
      audio: new Uint8Array([1, 2, 3]),
      mimeType: "audio/webm",
      expectedLanguage: "en",
      speakerId: "Facilitator",
    });

    expect(draft.originalText).toBe("hello from deepgram");
    expect(draft.isFinal).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("https://api.deepgram.com/v1/listen?"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws when Deepgram responds with a non-OK status", async () => {
    process.env.STT_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const { speechToTextProvider } = await import("./speech-to-text");
    await expect(
      speechToTextProvider.transcribeChunk({
        audio: new Uint8Array([1]),
        mimeType: "audio/webm",
        expectedLanguage: "en",
        speakerId: null,
      }),
    ).rejects.toThrow(/Deepgram transcription failed/);
  });
});
