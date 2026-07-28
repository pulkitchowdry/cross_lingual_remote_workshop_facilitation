import { describe, expect, it } from "vitest";
import { SUPPORTED_LANGUAGES } from "@/lib/session-contracts";
import { getDictionary, resolveLanguageFromAcceptLanguage } from "./i18n";

describe("resolveLanguageFromAcceptLanguage", () => {
  it("falls back to English when there is no header", () => {
    expect(resolveLanguageFromAcceptLanguage(null)).toBe("en");
    expect(resolveLanguageFromAcceptLanguage(undefined)).toBe("en");
  });

  it("picks the highest-priority supported language", () => {
    expect(resolveLanguageFromAcceptLanguage("es-ES,es;q=0.9,en;q=0.8")).toBe("es");
  });

  it("respects explicit q-values even out of header order", () => {
    expect(resolveLanguageFromAcceptLanguage("en;q=0.5,zh;q=0.9")).toBe("zh");
  });

  it("matches on the primary subtag, ignoring region", () => {
    expect(resolveLanguageFromAcceptLanguage("zh-CN,zh;q=0.9")).toBe("zh");
  });

  it("skips unsupported languages and falls through to a supported one", () => {
    expect(resolveLanguageFromAcceptLanguage("fr-FR,fr;q=0.9,es;q=0.5")).toBe("es");
  });

  it("falls back to English when nothing in the header is supported", () => {
    expect(resolveLanguageFromAcceptLanguage("fr-FR,de;q=0.9")).toBe("en");
  });

  it("supports a custom fallback", () => {
    expect(resolveLanguageFromAcceptLanguage("fr-FR", "zh")).toBe("zh");
  });

  it("tolerates optional whitespace around the ;q= delimiter (RFC 7231 OWS)", () => {
    expect(resolveLanguageFromAcceptLanguage("zh; q=0.9, en;q=0.5")).toBe("zh");
    expect(resolveLanguageFromAcceptLanguage("en ; q=0.5, zh ; q=0.9")).toBe("zh");
  });
});

describe("learner caption comprehension templates", () => {
  it("keeps the original caption text in every comprehension question", () => {
    const caption = "Normalize the request payload before validating fields.";

    for (const { value: language } of SUPPORTED_LANGUAGES) {
      const learner = getDictionary(language).learner;

      expect(learner.explainSimplyQuestion(caption)).toContain(caption);
      expect(learner.giveExampleQuestion(caption)).toContain(caption);
    }
  });
});

describe("analyticsParticipationRow", () => {
  // Reproduced live in UAT round 15: the facilitator analytics drawer read "1 messages" for a
  // single-message participant because the English/Spanish templates never varied for count === 1.
  it("uses the singular form for exactly one message/question in English", () => {
    const row = getDictionary("en").facilitator.analyticsParticipationRow("Learner", 1, 1, false);
    expect(row).toContain("1 message ·");
    expect(row).toContain("1 question");
    expect(row).not.toContain("1 messages");
    expect(row).not.toContain("1 questions");
  });

  it("uses the plural form for zero or many messages/questions in English", () => {
    expect(getDictionary("en").facilitator.analyticsParticipationRow("Learner", 0, 2, false)).toContain("0 messages");
    expect(getDictionary("en").facilitator.analyticsParticipationRow("Learner", 2, 0, false)).toContain("0 questions");
  });

  it("uses the singular form for exactly one message/question in Spanish", () => {
    const row = getDictionary("es").facilitator.analyticsParticipationRow("Alumno", 1, 1, false);
    expect(row).toContain("1 mensaje ·");
    expect(row).toContain("1 pregunta");
    expect(row).not.toContain("1 mensajes");
    expect(row).not.toContain("1 preguntas");
  });
});
