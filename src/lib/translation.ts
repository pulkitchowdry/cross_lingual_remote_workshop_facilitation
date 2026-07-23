import type { SupportedLanguage } from "@/lib/session-contracts";

export interface TranslationResult {
  text: string;
  provider: "deepl";
  qualitySignal: "provider-confirmed";
}

const deepLSourceCode: Record<SupportedLanguage, string> = {
  en: "EN",
  zh: "ZH",
  es: "ES",
};

const deepLTargetCode: Record<SupportedLanguage, string> = {
  en: "EN-US",
  zh: "ZH",
  es: "ES",
};

export async function translateText(
  text: string,
  sourceLanguage: SupportedLanguage,
  targetLanguage: SupportedLanguage,
): Promise<TranslationResult | null> {
  if (sourceLanguage === targetLanguage) return null;

  const apiKey = process.env.DEEPL_API_KEY;
  if (!apiKey) return null;

  const response = await fetch(process.env.DEEPL_API_URL ?? "https://api-free.deepl.com/v2/translate", {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: [text],
      source_lang: deepLSourceCode[sourceLanguage],
      target_lang: deepLTargetCode[targetLanguage],
      preserve_formatting: true,
      model_type: "prefer_quality_optimized",
    }),
    cache: "no-store",
  });

  if (!response.ok) return null;
  const payload = (await response.json()) as { translations?: Array<{ text?: string }> };
  const translated = payload.translations?.[0]?.text;
  if (!translated) return null;

  return { text: translated, provider: "deepl", qualitySignal: "provider-confirmed" };
}

/**
 * Server-only boundary matching `SpeechToTextProvider`/`InsightProvider`/
 * `RoomProvider` in `src/lib/providers/`, kept here (rather than moved) so
 * existing `translateText` call sites are unaffected.
 */
export interface TranslationProvider {
  readonly isConfigured: boolean;
  translate(
    text: string,
    sourceLanguage: SupportedLanguage,
    targetLanguage: SupportedLanguage,
  ): Promise<TranslationResult | null>;
}

export const translationProvider: TranslationProvider = {
  get isConfigured() {
    return Boolean(process.env.DEEPL_API_KEY);
  },
  translate: translateText,
};
