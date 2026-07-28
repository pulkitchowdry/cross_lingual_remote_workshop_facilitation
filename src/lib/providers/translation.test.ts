import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

function restoreEnv() {
  process.env = { ...ORIGINAL_ENV };
}

describe("translateText", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    restoreEnv();
    vi.resetModules();
  });

  it("returns null when source and target languages match, without calling any provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { translateText } = await import("./translation");

    await expect(translateText("hi", "en", "en")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("prefers the local-inference tier when configured, returning provider 'nllb'", async () => {
    process.env.LOCAL_INFERENCE_URL = "https://local.example.com";
    process.env.LOCAL_INFERENCE_SECRET = "s3cret";
    delete process.env.CLAUDE_API_KEY;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: "hola" }) }),
    );

    const { translateText } = await import("./translation");
    const result = await translateText("hello", "en", "es");

    expect(result).toEqual({ text: "hola", provider: "nllb", qualitySignal: "provider-confirmed", confidence: 88 });
  });

  it("falls back to Claude when local-inference fails and cloud fallback is allowed", async () => {
    process.env.LOCAL_INFERENCE_URL = "https://local.example.com";
    process.env.LOCAL_INFERENCE_SECRET = "s3cret";
    process.env.CLAUDE_API_KEY = "claude-key";
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("local.example.com")) return { ok: false, status: 500 };
      return {
        ok: true,
        json: async () => ({ content: [{ type: "text", text: "hola" }] }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const { translateText } = await import("./translation");
    const result = await translateText("hello", "en", "es");

    expect(result).toEqual({ text: "hola", provider: "claude", qualitySignal: "provider-confirmed", confidence: 96 });
    // 2 local-inference attempts (translation.ts retries a transient local failure
    // once before giving up on that tier) + 1 Claude call.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("returns null (never calls Claude) when local-inference fails and cloud fallback is disallowed", async () => {
    process.env.LOCAL_INFERENCE_URL = "https://local.example.com";
    process.env.LOCAL_INFERENCE_SECRET = "s3cret";
    process.env.CLAUDE_API_KEY = "claude-key";
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal("fetch", fetchMock);

    const { translateText } = await import("./translation");
    const result = await translateText("hello", "en", "es", { allowCloudFallback: false });

    expect(result).toBeNull();
    // Both local-inference retry attempts still run before giving up on that tier —
    // `allowCloudFallback` only gates what happens *after*, not the local retry itself.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("still returns a truncated Claude translation (logging a warning) rather than discarding it", async () => {
    delete process.env.LOCAL_INFERENCE_URL;
    delete process.env.LOCAL_INFERENCE_SECRET;
    process.env.CLAUDE_API_KEY = "claude-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ content: [{ type: "text", text: "cut off mid-sen" }], stop_reason: "max_tokens" }),
      }),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { translateText } = await import("./translation");
    const result = await translateText("hello", "en", "es");

    expect(result).toEqual({ text: "cut off mid-sen", provider: "claude", qualitySignal: "provider-confirmed", confidence: 40 });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("truncated"));
    errorSpy.mockRestore();
  });

  it("returns null when neither local-inference nor Claude is configured", async () => {
    delete process.env.LOCAL_INFERENCE_URL;
    delete process.env.LOCAL_INFERENCE_SECRET;
    delete process.env.CLAUDE_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { translateText } = await import("./translation");
    await expect(translateText("hello", "en", "es")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries once and succeeds after a transient (5xx) Claude response", async () => {
    delete process.env.LOCAL_INFERENCE_URL;
    delete process.env.LOCAL_INFERENCE_SECRET;
    process.env.CLAUDE_API_KEY = "claude-key";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => "overloaded" })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ content: [{ type: "text", text: "hola" }] }) });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { translateText } = await import("./translation");
    const result = await translateText("hello", "en", "es");

    expect(result).toEqual({ text: "hola", provider: "claude", qualitySignal: "provider-confirmed", confidence: 96 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries once and succeeds after a network-level error on the first attempt", async () => {
    delete process.env.LOCAL_INFERENCE_URL;
    delete process.env.LOCAL_INFERENCE_SECRET;
    process.env.CLAUDE_API_KEY = "claude-key";
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ content: [{ type: "text", text: "hola" }] }) });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { translateText } = await import("./translation");
    const result = await translateText("hello", "en", "es");

    expect(result).toEqual({ text: "hola", provider: "claude", qualitySignal: "provider-confirmed", confidence: 96 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-transient (4xx, non-429) Claude response", async () => {
    delete process.env.LOCAL_INFERENCE_URL;
    delete process.env.LOCAL_INFERENCE_SECRET;
    process.env.CLAUDE_API_KEY = "claude-key";
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "invalid api key" });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { translateText } = await import("./translation");
    const result = await translateText("hello", "en", "es");

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("jitters the post-429 retry delay instead of using a fixed 400ms (Math.random floor)", async () => {
    delete process.env.LOCAL_INFERENCE_URL;
    delete process.env.LOCAL_INFERENCE_SECRET;
    process.env.CLAUDE_API_KEY = "claude-key";
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => "rate limited" })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ content: [{ type: "text", text: "hola" }] }) });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { translateText } = await import("./translation");
    const resultPromise = translateText("hello", "en", "es");

    // Math.random() pinned to 0 puts the jittered delay at its floor (half the 400ms
    // base) — advancing just short of it must not yet fire the retry.
    await vi.advanceTimersByTimeAsync(199);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(resultPromise).resolves.toEqual({
      text: "hola",
      provider: "claude",
      qualitySignal: "provider-confirmed",
      confidence: 96,
    });

    vi.useRealTimers();
  });

  it("jitters the post-429 retry delay instead of using a fixed 400ms (Math.random ceiling)", async () => {
    delete process.env.LOCAL_INFERENCE_URL;
    delete process.env.LOCAL_INFERENCE_SECRET;
    process.env.CLAUDE_API_KEY = "claude-key";
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(1);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => "rate limited" })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ content: [{ type: "text", text: "hola" }] }) });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { translateText } = await import("./translation");
    const resultPromise = translateText("hello", "en", "es");

    // Math.random() pinned to 1 puts the jittered delay at its ceiling (1.5x the 400ms
    // base) — a fixed, non-jittered implementation would already have retried by 400ms.
    await vi.advanceTimersByTimeAsync(599);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(resultPromise).resolves.toEqual({
      text: "hola",
      provider: "claude",
      qualitySignal: "provider-confirmed",
      confidence: 96,
    });

    vi.useRealTimers();
  });

  it("logs and falls back to Claude when local-inference responds 200 with an empty translation", async () => {
    process.env.LOCAL_INFERENCE_URL = "https://local.example.com";
    process.env.LOCAL_INFERENCE_SECRET = "s3cret";
    process.env.CLAUDE_API_KEY = "claude-key";
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("local.example.com")) return { ok: true, json: async () => ({ text: "" }) };
      return {
        ok: true,
        json: async () => ({ content: [{ type: "text", text: "hola" }] }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { translateText } = await import("./translation");
    const result = await translateText("hello", "en", "es");

    expect(result).toEqual({ text: "hola", provider: "claude", qualitySignal: "provider-confirmed", confidence: 96 });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("empty translation"));
  });

  it("tries Claude first when a glossary hint is present and cloud fallback is allowed, skipping local-inference on success", async () => {
    process.env.LOCAL_INFERENCE_URL = "https://local.example.com";
    process.env.LOCAL_INFERENCE_SECRET = "s3cret";
    process.env.CLAUDE_API_KEY = "claude-key";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "hola (glosario)" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { translateText } = await import("./translation");
    const result = await translateText("hello", "en", "es", { glossaryHint: '- "hello" -> "hola (glosario)"' });

    expect(result).toEqual({
      text: "hola (glosario)",
      provider: "claude",
      qualitySignal: "provider-confirmed",
      confidence: 96,
    });
    // Claude succeeded on the first (and only) call — local-inference, though configured,
    // must never be touched once the glossary-preferred Claude translation comes back.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to local-inference when a glossary hint is present but Claude is unconfigured (no API key)", async () => {
    process.env.LOCAL_INFERENCE_URL = "https://local.example.com";
    process.env.LOCAL_INFERENCE_SECRET = "s3cret";
    delete process.env.CLAUDE_API_KEY;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: "hola local" }) });
    vi.stubGlobal("fetch", fetchMock);

    const { translateText } = await import("./translation");
    const result = await translateText("hello", "en", "es", { glossaryHint: '- "hello" -> "hola"' });

    expect(result).toEqual({ text: "hola local", provider: "nllb", qualitySignal: "provider-confirmed", confidence: 88 });
    // translateWithClaude returns null immediately (no fetch call at all) when
    // CLAUDE_API_KEY is unset, so the only fetch here is the successful local-inference call —
    // a facilitator running local-inference only must not lose the whole message just because
    // it happened to contain a glossary term.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to local-inference when a glossary hint is present and Claude fails", async () => {
    process.env.LOCAL_INFERENCE_URL = "https://local.example.com";
    process.env.LOCAL_INFERENCE_SECRET = "s3cret";
    process.env.CLAUDE_API_KEY = "claude-key";
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("local.example.com")) return { ok: true, json: async () => ({ text: "hola local" }) };
      return { ok: false, status: 401, text: async () => "invalid api key" };
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { translateText } = await import("./translation");
    const result = await translateText("hello", "en", "es", { glossaryHint: '- "hello" -> "hola"' });

    expect(result).toEqual({ text: "hola local", provider: "nllb", qualitySignal: "provider-confirmed", confidence: 88 });
    // 1 Claude attempt (a non-transient 401 doesn't retry) + 1 successful local-inference
    // attempt — a transiently-down or misconfigured Claude must not sink glossary-matched
    // text when local-inference is healthy and would have succeeded.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("still returns null (never calls Claude) when cloud fallback is disallowed, even with a glossary hint present", async () => {
    process.env.LOCAL_INFERENCE_URL = "https://local.example.com";
    process.env.LOCAL_INFERENCE_SECRET = "s3cret";
    process.env.CLAUDE_API_KEY = "claude-key";
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { translateText } = await import("./translation");
    const result = await translateText("hello", "en", "es", {
      allowCloudFallback: false,
      glossaryHint: '- "hello" -> "hola"',
    });

    expect(result).toBeNull();
    // Identical to the no-glossary LOCAL_ONLY case: both local-inference retry attempts run
    // and Claude is never touched — a glossaryHint only changes tier ordering when cloud
    // fallback is actually allowed.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
