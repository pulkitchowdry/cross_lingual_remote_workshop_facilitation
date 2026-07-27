import { describe, expect, it } from "vitest";
import { computeOverallConfidence, estimateNetworkConfidence, estimateTranslationConfidence } from "@/lib/confidence";

describe("computeOverallConfidence", () => {
  it("is High when every signal is strong", () => {
    const result = computeOverallConfidence({ audioQuality: 95, translation: 96 });
    expect(result.level).toBe("high");
    expect(result.rootCause).toBeNull();
  });

  it("is Low with an audio root cause when audio quality is poor (issue #130 scenario 2)", () => {
    const result = computeOverallConfidence({ audioQuality: 48, translation: 98 });
    expect(result.level).toBe("low");
    expect(result.rootCause).toBe("audio");
  });

  it("is Low with a translation root cause when translation confidence is poor (scenario 3)", () => {
    const result = computeOverallConfidence({ audioQuality: 98, translation: 55 });
    expect(result.level).toBe("low");
    expect(result.rootCause).toBe("translation");
  });

  it("is Low with a network root cause when connection quality is poor", () => {
    const result = computeOverallConfidence({ audioQuality: 98, translation: 96, network: 30 });
    expect(result.level).toBe("low");
    expect(result.rootCause).toBe("network");
  });

  it("treats missing signals as no evidence of a problem, not zero", () => {
    const result = computeOverallConfidence({});
    expect(result.overall).toBe(100);
    expect(result.level).toBe("high");
  });
});

describe("estimateTranslationConfidence", () => {
  it("scores claude translations highest", () => {
    expect(estimateTranslationConfidence("claude", false)).toBeGreaterThan(
      estimateTranslationConfidence("nllb", false),
    );
  });

  it("scores a truncated translation below the root-cause threshold", () => {
    expect(estimateTranslationConfidence("claude", true)).toBeLessThan(60);
  });
});

describe("estimateNetworkConfidence", () => {
  it("scores each LiveKit connection-quality label in descending order", () => {
    expect(estimateNetworkConfidence("excellent")).toBeGreaterThan(estimateNetworkConfidence("good")!);
    expect(estimateNetworkConfidence("good")).toBeGreaterThan(estimateNetworkConfidence("poor")!);
    expect(estimateNetworkConfidence("poor")).toBeGreaterThan(estimateNetworkConfidence("lost")!);
    expect(estimateNetworkConfidence("lost")).toBe(0);
  });

  it("treats a missing or unrecognized report as no evidence of a problem, not a measured value", () => {
    expect(estimateNetworkConfidence(undefined)).toBeUndefined();
    expect(estimateNetworkConfidence(null)).toBeUndefined();
    expect(estimateNetworkConfidence("unknown")).toBeUndefined();
  });
});
