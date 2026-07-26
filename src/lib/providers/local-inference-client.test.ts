import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_URL = process.env.LOCAL_INFERENCE_URL;
const ORIGINAL_SECRET = process.env.LOCAL_INFERENCE_SECRET;

function restoreEnv() {
  if (ORIGINAL_URL === undefined) delete process.env.LOCAL_INFERENCE_URL;
  else process.env.LOCAL_INFERENCE_URL = ORIGINAL_URL;
  if (ORIGINAL_SECRET === undefined) delete process.env.LOCAL_INFERENCE_SECRET;
  else process.env.LOCAL_INFERENCE_SECRET = ORIGINAL_SECRET;
}

describe("local-inference-client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    restoreEnv();
    vi.resetModules();
  });

  it("reports isLocalInferenceConfigured only once both vars are set", async () => {
    delete process.env.LOCAL_INFERENCE_URL;
    delete process.env.LOCAL_INFERENCE_SECRET;
    const { isLocalInferenceConfigured } = await import("./local-inference-client");
    expect(isLocalInferenceConfigured()).toBe(false);

    process.env.LOCAL_INFERENCE_URL = "https://local.example.com";
    process.env.LOCAL_INFERENCE_SECRET = "s3cret";
    expect(isLocalInferenceConfigured()).toBe(true);
  });

  it("localTranslate sends a bearer-authenticated POST and returns the translated text", async () => {
    process.env.LOCAL_INFERENCE_URL = "https://local.example.com";
    process.env.LOCAL_INFERENCE_SECRET = "s3cret";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: "hola", provider: "nllb" }) });
    vi.stubGlobal("fetch", fetchMock);

    const { localTranslate } = await import("./local-inference-client");
    const result = await localTranslate("hello", "en", "es");

    expect(result).toEqual({ text: "hola" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://local.example.com/translate",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer s3cret" }),
      }),
    );
  });

  it("throws when the local-inference translate response is non-OK", async () => {
    process.env.LOCAL_INFERENCE_URL = "https://local.example.com";
    process.env.LOCAL_INFERENCE_SECRET = "s3cret";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 502, text: async () => "bad gateway" }));

    const { localTranslate } = await import("./local-inference-client");
    await expect(localTranslate("hello", "en", "es")).rejects.toThrow(/local-inference translate failed/);
  });

  it("throws immediately when local-inference is not configured, without calling fetch", async () => {
    delete process.env.LOCAL_INFERENCE_URL;
    delete process.env.LOCAL_INFERENCE_SECRET;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { localTranslate } = await import("./local-inference-client");
    await expect(localTranslate("hello", "en", "es")).rejects.toThrow(/LOCAL_INFERENCE_URL is missing/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("localSynthesize returns raw audio bytes with a wav mime type", async () => {
    process.env.LOCAL_INFERENCE_URL = "https://local.example.com";
    process.env.LOCAL_INFERENCE_SECRET = "s3cret";
    const audioBytes = new Uint8Array([1, 2, 3, 4]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => audioBytes.buffer }),
    );

    const { localSynthesize } = await import("./local-inference-client");
    const result = await localSynthesize("hola", "es");
    expect(result).toEqual({ audio: audioBytes, mimeType: "audio/wav" });
  });

  it("localTranscribe posts multipart form data and returns transcribed text", async () => {
    process.env.LOCAL_INFERENCE_URL = "https://local.example.com";
    process.env.LOCAL_INFERENCE_SECRET = "s3cret";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: "hello world" }) });
    vi.stubGlobal("fetch", fetchMock);

    const { localTranscribe } = await import("./local-inference-client");
    const result = await localTranscribe(new Uint8Array([1, 2, 3]), "audio/webm", "en");

    expect(result).toEqual({ text: "hello world" });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBeInstanceOf(FormData);
  });
});
