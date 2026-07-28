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

  it("selects the ElevenLabs provider and returns WAV-wrapped PCM audio when TTS_API_KEY is set", async () => {
    process.env.TTS_API_KEY = "test-key";
    // Raw (headerless) 16-bit PCM, as requested via `output_format=pcm_*` — two
    // little-endian samples: 0x0201 and 0x0403.
    const rawPcm = new Uint8Array([1, 2, 3, 4]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => rawPcm.buffer,
    });
    vi.stubGlobal("fetch", fetchMock);

    const { textToSpeechProvider, toPcmSamples, ELEVENLABS_PCM_SAMPLE_RATE } = await import("./text-to-speech");
    expect(textToSpeechProvider.isConfigured).toBe(true);

    const result = await textToSpeechProvider.synthesize("hello", "en");
    expect(result?.mimeType).toBe("audio/wav");
    expect(result?.provider).toBe("elevenlabs");
    // The synthesized bytes are now a real WAV container (so the same route that
    // streams this straight to a browser `<audio>` tag — the recap player — still
    // gets something playable) — decode it back rather than asserting raw bytes.
    const decoded = toPcmSamples(result!.audio);
    expect(decoded.sampleRate).toBe(ELEVENLABS_PCM_SAMPLE_RATE);
    expect(decoded.channels).toBe(1);
    expect(Array.from(decoded.samples)).toEqual(Array.from(new Int16Array(rawPcm.buffer)));
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("https://api.elevenlabs.io/v1/text-to-speech/"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock.mock.calls[0][0]).toContain(`output_format=pcm_${ELEVENLABS_PCM_SAMPLE_RATE}`);
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
    const rawPcm = new Uint8Array([1, 2, 3, 4]);
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("local.example.com")) return { ok: false, status: 500 };
      return { ok: true, arrayBuffer: async () => rawPcm.buffer };
    });
    vi.stubGlobal("fetch", fetchMock);

    const { textToSpeechProvider, toPcmSamples } = await import("./text-to-speech");
    const result = await textToSpeechProvider.synthesize("hello", "en");
    expect(result?.mimeType).toBe("audio/wav");
    expect(result?.provider).toBe("elevenlabs");
    expect(Array.from(toPcmSamples(result!.audio).samples)).toEqual(Array.from(new Int16Array(rawPcm.buffer)));
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
    // Both local-inference retry attempts still run before giving up on that tier
    // (matching translateText's LOCAL_TRANSLATE_ATTEMPTS pattern — see translation.test.ts)
    // — `allowCloudFallback` only gates what happens *after* the local tier is exhausted,
    // never ElevenLabs itself.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("toPcmSamples", () => {
  function writeAscii(view: DataView, offset: number, tag: string) {
    for (let i = 0; i < tag.length; i++) view.setUint8(offset + i, tag.charCodeAt(i));
  }

  it("locates the data chunk past an extra chunk inserted before it, not a hardcoded 44-byte offset", async () => {
    const { toPcmSamples } = await import("./text-to-speech");
    const pcm = new Int16Array([10, -20, 30]);
    // RIFF/WAVE, "fmt " (16 bytes), a made-up 6-byte "LIST" chunk (odd length, so its
    // one padding byte must be accounted for too), then "data" — mirrors a real encoder
    // being free to emit metadata chunks ahead of the audio payload.
    const listBody = 5; // odd, forces a 1-byte pad after it
    const totalSize = 4 + (8 + 16) + (8 + listBody + (listBody % 2)) + (8 + pcm.byteLength);
    const buffer = new ArrayBuffer(8 + totalSize);
    const view = new DataView(buffer);
    writeAscii(view, 0, "RIFF");
    view.setUint32(4, totalSize, true);
    writeAscii(view, 8, "WAVE");

    let offset = 12;
    writeAscii(view, offset, "fmt ");
    view.setUint32(offset + 4, 16, true);
    view.setUint16(offset + 8, 1, true); // PCM
    view.setUint16(offset + 10, 1, true); // mono
    view.setUint32(offset + 12, 22_050, true); // sample rate
    view.setUint32(offset + 16, 44_100, true); // byte rate
    view.setUint16(offset + 20, 2, true); // block align
    view.setUint16(offset + 22, 16, true); // bits per sample
    offset += 8 + 16;

    writeAscii(view, offset, "LIST");
    view.setUint32(offset + 4, listBody, true);
    offset += 8 + listBody + (listBody % 2);

    writeAscii(view, offset, "data");
    view.setUint32(offset + 4, pcm.byteLength, true);
    new Int16Array(buffer, offset + 8, pcm.length).set(pcm);

    const result = toPcmSamples(new Uint8Array(buffer));
    expect(result.sampleRate).toBe(22_050);
    expect(result.channels).toBe(1);
    expect(Array.from(result.samples)).toEqual([10, -20, 30]);
  });

  it("throws on a buffer that isn't a valid RIFF/WAVE container", async () => {
    const { toPcmSamples } = await import("./text-to-speech");
    expect(() => toPcmSamples(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toThrow(/not a valid RIFF\/WAVE/);
  });
});
