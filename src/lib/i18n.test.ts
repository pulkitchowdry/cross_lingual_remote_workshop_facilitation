import { describe, expect, it } from "vitest";
import { resolveLanguageFromAcceptLanguage } from "./i18n";

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
});
