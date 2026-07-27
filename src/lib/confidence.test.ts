import { describe, expect, it } from "vitest";
import {
  computeOverallConfidence,
  estimateTerminologyConfidence,
  estimateTranslationConfidence,
} from "@/lib/confidence";

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

  it("is Medium with a terminology root cause when only terminology is weak (scenario 4)", () => {
    const result = computeOverallConfidence({ audioQuality: 98, translation: 96, terminology: 42 });
    expect(result.level).toBe("medium");
    expect(result.rootCause).toBe("terminology");
  });

  it("prefers a severe (audio/translation/network) root cause over terminology", () => {
    const result = computeOverallConfidence({ audioQuality: 40, terminology: 30 });
    expect(result.rootCause).toBe("audio");
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

describe("estimateTerminologyConfidence", () => {
  it("returns full confidence with no glossary configured", () => {
    expect(estimateTerminologyConfidence("The webhook payload is idempotent.", [])).toBe(100);
  });

  it("lowers confidence for a glossary term with no approved translation", () => {
    const score = estimateTerminologyConfidence("The webhook payload is idempotent.", [
      { sourceTerm: "webhook", aliases: [], approvedTranslation: null },
    ]);
    expect(score).toBeLessThan(100);
  });

  it("ignores glossary terms that already have an approved translation", () => {
    const score = estimateTerminologyConfidence("The webhook payload is idempotent.", [
      { sourceTerm: "webhook", aliases: [], approvedTranslation: "Webhook (自动回调)" },
    ]);
    expect(score).toBe(100);
  });

  it("matches on aliases too", () => {
    const score = estimateTerminologyConfidence("Check the API Gateway config.", [
      { sourceTerm: "api gateway", aliases: ["gateway"], approvedTranslation: null },
    ]);
    expect(score).toBeLessThan(100);
  });
});
