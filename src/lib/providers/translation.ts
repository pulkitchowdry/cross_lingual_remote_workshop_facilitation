import type { SupportedLanguage } from "@/lib/session-contracts";
import { isLocalInferenceConfigured, localTranslate } from "@/lib/providers/local-inference-client";

export interface TranslationResult {
  text: string;
  provider: string;
  qualitySignal: "provider-confirmed";
}

const languageName: Record<SupportedLanguage, string> = {
  en: "English",
  zh: "Chinese",
  es: "Spanish",
};

const CLAUDE_TRANSLATION_MODEL = "claude-haiku-4-5-20251001";

/**
 * Cloud fallback tier — Claude Haiku. Never throws; any error/timeout/non-OK
 * degrades to `null` (see `translateText`'s doc comment for why).
 */
async function translateWithClaude(
  text: string,
  sourceLanguage: SupportedLanguage,
  targetLanguage: SupportedLanguage,
): Promise<TranslationResult | null> {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) return null;

  try {
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
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      console.error(
        `[translation] Claude translate failed with status ${response.status} (${sourceLanguage}->${targetLanguage}).`,
      );
      return null;
    }
    const payload = (await response.json()) as { content?: Array<{ type?: string; text?: string }> };
    const translated = payload.content?.find((block) => block.type === "text")?.text?.trim();
    if (!translated) return null;

    return { text: translated, provider: "claude", qualitySignal: "provider-confirmed" };
  } catch (error) {
    console.error(`[translation] Claude request threw (${sourceLanguage}->${targetLanguage}):`, error);
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const LOCAL_TRANSLATE_ATTEMPTS = 2;
const LOCAL_TRANSLATE_RETRY_DELAY_MS = 400;

/**
 * Tries the self-hosted NLLB tier first (privacy-preserving — nothing leaves
 * this server), then falls back to Claude on any local failure, unless the
 * caller passes `allowCloudFallback: false` (a session's strict-privacy
 * mode — see `docs/TRANSLATION_ARCHITECTURE.md` Part 5), in which case a
 * local failure degrades straight to `null` just like an unconfigured/failed
 * Claude call always has. A hung or errored translation for one learner
 * language must not sink the whole batch — publishTranslatedCaption/
 * sendChatMessage run this per-language inside `Promise.all`.
 */
export async function translateText(
  text: string,
  sourceLanguage: SupportedLanguage,
  targetLanguage: SupportedLanguage,
  options?: { allowCloudFallback?: boolean },
): Promise<TranslationResult | null> {
  if (sourceLanguage === targetLanguage) return null;
  const allowCloudFallback = options?.allowCloudFallback ?? true;

  if (isLocalInferenceConfigured()) {
    for (let attempt = 1; attempt <= LOCAL_TRANSLATE_ATTEMPTS; attempt++) {
      try {
        const { text: translated } = await localTranslate(text, sourceLanguage, targetLanguage);
        if (translated) return { text: translated, provider: "nllb", qualitySignal: "provider-confirmed" };
        break;
      } catch (error) {
        console.error(
          `[translation] local-inference translate attempt ${attempt}/${LOCAL_TRANSLATE_ATTEMPTS} failed ` +
            `(${sourceLanguage}->${targetLanguage}):`,
          error,
        );
        if (attempt < LOCAL_TRANSLATE_ATTEMPTS) await delay(LOCAL_TRANSLATE_RETRY_DELAY_MS);
        // Last attempt exhausted: fall through to the cloud tier below (or to null, if disallowed).
      }
    }
  }

  if (!allowCloudFallback) return null;
  return translateWithClaude(text, sourceLanguage, targetLanguage);
}

/**
 * Server-only boundary matching `SpeechToTextProvider`/`InsightProvider`/
 * `RoomProvider`. Application code should depend on `TranslationProvider`,
 * never on a vendor API directly, so the translation vendor/tier can change
 * without touching call sites.
 */
export interface TranslationProvider {
  readonly isConfigured: boolean;
  translate(
    text: string,
    sourceLanguage: SupportedLanguage,
    targetLanguage: SupportedLanguage,
    options?: { allowCloudFallback?: boolean },
  ): Promise<TranslationResult | null>;
}

export const translationProvider: TranslationProvider = {
  get isConfigured() {
    return Boolean(process.env.CLAUDE_API_KEY) || isLocalInferenceConfigured();
  },
  translate: translateText,
};
