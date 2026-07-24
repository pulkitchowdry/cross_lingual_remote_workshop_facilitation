import { afterEach, describe, expect, it, vi } from "vitest";
import { parseDeepgramStreamingMessage } from "./speech-to-text";

const ORIGINAL_STT_API_KEY = process.env.STT_API_KEY;

describe("parseDeepgramStreamingMessage", () => {
  it("extracts final transcripts from a Results message", () => {
    const raw = JSON.stringify({
      type: "Results",
      is_final: true,
      channel: { alternatives: [{ transcript: "we tried adding an early return" }] },
    });
    expect(parseDeepgramStreamingMessage(raw)).toEqual({
      text: "we tried adding an early return",
      isFinal: true,
    });
  });

  it("extracts interim transcripts as non-final", () => {
    const raw = JSON.stringify({
      type: "Results",
      is_final: false,
      channel: { alternatives: [{ transcript: "we tried" }] },
    });
    expect(parseDeepgramStreamingMessage(raw)).toEqual({ text: "we tried", isFinal: false });
  });

  it("ignores non-Results message types", () => {
    expect(parseDeepgramStreamingMessage(JSON.stringify({ type: "Metadata" }))).toBeNull();
  });

  it("ignores Results messages with an empty transcript", () => {
    const raw = JSON.stringify({ type: "Results", is_final: true, channel: { alternatives: [{ transcript: "" }] } });
    expect(parseDeepgramStreamingMessage(raw)).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseDeepgramStreamingMessage("not json")).toBeNull();
  });
});

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
    expect(speechToTextProvider.openStream).toBeUndefined();
    const draft = await speechToTextProvider.transcribeChunk({
      audio: new Uint8Array(),
      mimeType: "audio/webm",
      expectedLanguage: "en",
      speakerId: "Facilitator",
    });
    expect(draft.originalText).toContain("mock transcription");
  });

  it("exposes openStream and throws when STT_API_KEY is missing at call time", async () => {
    process.env.STT_API_KEY = "test-key";
    const { speechToTextProvider } = await import("./speech-to-text");
    expect(speechToTextProvider.openStream).toBeInstanceOf(Function);

    delete process.env.STT_API_KEY;
    expect(() =>
      speechToTextProvider.openStream!({
        expectedLanguage: "en",
        onSegment: () => {},
        onError: () => {},
      }),
    ).toThrow(/Deepgram is not configured/);
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
