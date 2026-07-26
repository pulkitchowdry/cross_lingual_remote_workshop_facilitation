import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

function restoreEnv() {
  process.env = { ...ORIGINAL_ENV };
}

describe("caption latency logging", () => {
  afterEach(() => {
    restoreEnv();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("is disabled unless explicitly enabled outside production", async () => {
    const { isCaptionLatencyLogEnabled } = await import("./caption-latency-log");

    vi.stubEnv("NODE_ENV", "development");
    delete process.env.CAPTION_LATENCY_LOGS;
    expect(isCaptionLatencyLogEnabled()).toBe(false);

    process.env.CAPTION_LATENCY_LOGS = "1";
    expect(isCaptionLatencyLogEnabled()).toBe(true);

    vi.stubEnv("NODE_ENV", "production");
    expect(isCaptionLatencyLogEnabled()).toBe(false);
  });

  it("logs timing metadata without caption or audio content", async () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.CAPTION_LATENCY_LOGS = "1";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { logCaptionLatency } = await import("./caption-latency-log");

    logCaptionLatency({
      sessionId: "session-1",
      segmentId: "segment-1",
      source: "browser-ws",
      sourceLanguage: "en",
      requestedTargetLanguages: ["es", "zh"],
      translatedTargetLanguages: ["es"],
      missingTargetLanguages: ["zh"],
      translationProviders: ["nllb"],
      audioSubmittedAtMs: 100,
      originalCaptionReadyAtMs: 350,
      translationsCompleteAtMs: 650,
      persistedAtMs: 700,
    });

    expect(logSpy).toHaveBeenCalledWith("[caption-latency]", {
      sessionId: "session-1",
      segmentId: "segment-1",
      source: "browser-ws",
      sourceLanguage: "en",
      requestedTargetLanguages: ["es", "zh"],
      translatedTargetLanguages: ["es"],
      missingTargetLanguages: ["zh"],
      translationProviders: ["nllb"],
      speechToOriginalMs: 250,
      originalToTranslatedMs: 300,
      originalToPersistedMs: 350,
    });
  });
});
