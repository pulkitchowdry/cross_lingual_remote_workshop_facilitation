import type { SupportedLanguage } from "@/lib/session-contracts";

export interface TranslationResult {
  text: string;
  provider: "claude";
  qualitySignal: "provider-confirmed";
}

const languageName: Record<SupportedLanguage, string> = {
  en: "English",
  zh: "Chinese",
  es: "Spanish",
};

const CLAUDE_TRANSLATION_MODEL = "claude-haiku-4-5-20251001";

export async function translateText(
  text: string,
  sourceLanguage: SupportedLanguage,
  targetLanguage: SupportedLanguage,
): Promise<TranslationResult | null> {
  if (sourceLanguage === targetLanguage) return null;

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) return null;

  const response = await fetch(process.env.CLAUDE_API_URL ?? "https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_TRANSLATION_MODEL,
      max_tokens: 1024,
      system:
        `You are a real-time translation engine for a live workshop caption pipeline. ` +
        `Translate the user's message from ${languageName[sourceLanguage]} to ${languageName[targetLanguage]}. ` +
        `Reply with only the translated text, preserving tone and formatting. Do not add commentary, quotes, or explanations.`,
      messages: [{ role: "user", content: text }],
    }),
    cache: "no-store",
  });

  if (!response.ok) return null;
  const payload = (await response.json()) as { content?: Array<{ type?: string; text?: string }> };
  const translated = payload.content?.find((block) => block.type === "text")?.text?.trim();
  if (!translated) return null;

  return { text: translated, provider: "claude", qualitySignal: "provider-confirmed" };
}

/**
 * Server-only boundary matching `SpeechToTextProvider`/`InsightProvider`/
 * `RoomProvider`. Application code should depend on `TranslationProvider`,
 * never on the Claude API directly, so the translation vendor can change
 * without touching call sites.
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
    return Boolean(process.env.CLAUDE_API_KEY);
  },
  translate: translateText,
};
