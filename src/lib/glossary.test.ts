import { describe, expect, it } from "vitest";
import {
  buildGlossaryPromptHint,
  detectCandidateTerms,
  findGlossaryMatches,
  parseCsv,
  parseGlossaryRows,
  preferredTranslation,
  translationUsesPreferredTerm,
  type CentralGlossaryEntryLike,
} from "@/lib/glossary";

const webhook: CentralGlossaryEntryLike = { sourceTerm: "Webhook", translate: false, translations: {} };
const featureFlag: CentralGlossaryEntryLike = {
  sourceTerm: "Feature Flag",
  translate: true,
  translations: { zh: "功能开关", es: "Bandera de Función" },
};

describe("findGlossaryMatches", () => {
  it("finds a whole-word match regardless of case", () => {
    const matches = findGlossaryMatches("Let's discuss the webhook integration.", [webhook, featureFlag]);
    expect(matches).toHaveLength(1);
    expect(matches[0].entry.sourceTerm).toBe("Webhook");
  });

  it("does not match a substring inside another word", () => {
    const matches = findGlossaryMatches("Webhooking is not a real word.", [webhook]);
    expect(matches).toHaveLength(0);
  });

  it("returns nothing for an empty glossary", () => {
    expect(findGlossaryMatches("API Gateway webhook", [])).toEqual([]);
  });
});

describe("preferredTranslation", () => {
  it("keeps translate:false entries verbatim in every language", () => {
    expect(preferredTranslation(webhook, "zh")).toBe("Webhook");
  });

  it("returns the language-specific preferred translation when set", () => {
    expect(preferredTranslation(featureFlag, "zh")).toBe("功能开关");
  });

  it("returns null when the glossary has no translation for that language", () => {
    expect(preferredTranslation(featureFlag, "en")).toBeNull();
  });
});

describe("buildGlossaryPromptHint", () => {
  it("returns null with no matches", () => {
    expect(buildGlossaryPromptHint([], "zh")).toBeNull();
  });

  it("includes the preferred rendering for each matched term", () => {
    const hint = buildGlossaryPromptHint(
      [
        { entry: webhook, matchedText: "webhook" },
        { entry: featureFlag, matchedText: "Feature Flag" },
      ],
      "zh",
    );
    expect(hint).toContain('"Webhook" -> "Webhook"');
    expect(hint).toContain('"Feature Flag" -> "功能开关"');
  });
});

describe("translationUsesPreferredTerm", () => {
  it("is case-insensitive and substring-based", () => {
    expect(translationUsesPreferredTerm("请检查 Webhook 配置", "Webhook")).toBe(true);
    expect(translationUsesPreferredTerm("请检查网络钩子配置", "Webhook")).toBe(false);
  });
});

describe("parseGlossaryRows", () => {
  it("parses the issue #131 example CSV format", () => {
    const header = ["Source Term", "Translate?", "Chinese (Simplified)", "Spanish", "Notes"];
    const rows = [
      ["Workshop Hub", "No", "Workshop Hub", "Workshop Hub", "Product name"],
      ["Feature Flag", "Yes", "功能开关", "Bandera de Función", "Software development term"],
    ];
    const parsed = parseGlossaryRows(header, rows);
    expect(parsed).toEqual([
      { sourceTerm: "Workshop Hub", translate: false, translations: { zh: "Workshop Hub", es: "Workshop Hub" }, notes: "Product name" },
      {
        sourceTerm: "Feature Flag",
        translate: true,
        translations: { zh: "功能开关", es: "Bandera de Función" },
        notes: "Software development term",
      },
    ]);
  });

  it("skips blank rows and throws without a Source Term column", () => {
    expect(() => parseGlossaryRows(["Foo", "Bar"], [["a", "b"]])).toThrow(/Source Term/);
  });
});

describe("parseCsv", () => {
  it("parses a simple comma-separated file with a header row", () => {
    const csv = "Source Term,Translate?,Notes\nWebhook,No,Technical term\n";
    expect(parseCsv(csv)).toEqual([
      ["Source Term", "Translate?", "Notes"],
      ["Webhook", "No", "Technical term"],
    ]);
  });

  it("handles quoted fields containing commas and escaped quotes", () => {
    const csv = 'Term,Notes\n"API, Gateway","Says ""hello"""\n';
    expect(parseCsv(csv)).toEqual([
      ["Term", "Notes"],
      ["API, Gateway", 'Says "hello"'],
    ]);
  });

  it("skips blank lines", () => {
    const csv = "Term\nWebhook\n\nAPI\n";
    expect(parseCsv(csv)).toEqual([["Term"], ["Webhook"], ["API"]]);
  });
});

describe("detectCandidateTerms", () => {
  it("detects acronyms, CamelCase identifiers, and alphanumeric terms", () => {
    const found = detectCandidateTerms("We wired up OAuth2 through the GPT4 API using WebhookHandler.", new Set(["API"]));
    expect(found).toEqual(expect.arrayContaining(["OAuth2", "GPT4", "WebhookHandler"]));
    expect(found).not.toContain("API");
  });

  it("ignores common short acronyms on the stoplist", () => {
    expect(detectCandidateTerms("Let's sync ASAP, the ETA is unclear.", new Set())).toEqual([]);
  });
});
