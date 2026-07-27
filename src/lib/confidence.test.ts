import { describe, expect, it } from "vitest";
import {
  computeOverallConfidence,
  estimateCentralGlossaryConfidence,
  estimateNetworkConfidence,
  estimateTerminologyConfidence,
  estimateTranslationConfidence,
} from "@/lib/confidence";
import type { CentralGlossaryEntryLike, GlossaryMatch } from "@/lib/glossary";

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

describe("estimateCentralGlossaryConfidence", () => {
  const featureFlag: CentralGlossaryEntryLike = {
    sourceTerm: "Feature Flag",
    translate: true,
    translations: { zh: "功能开关" },
  };
  it("is unaffected with no matches", () => {
    expect(estimateCentralGlossaryConfidence("任何文本", [], "zh")).toBe(100);
  });

  it("is full confidence when the translation used the preferred term (Glossary Match)", () => {
    const matches: GlossaryMatch[] = [{ entry: featureFlag, matchedText: "Feature Flag" }];
    expect(estimateCentralGlossaryConfidence("请检查这个 功能开关。", matches, "zh")).toBe(100);
  });

  it("is penalized harder for a Glossary Mismatch than an Unknown Technical Term", () => {
    const matches: GlossaryMatch[] = [{ entry: featureFlag, matchedText: "Feature Flag" }];
    const mismatchScore = estimateCentralGlossaryConfidence("请检查这个 特性标志。", matches, "zh");
    const unknownScore = estimateCentralGlossaryConfidence("请检查这个术语。", matches, "es");
    expect(mismatchScore).toBeLessThan(unknownScore);
  });
});
