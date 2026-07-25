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
      console.error(`translateWithClaude: Claude API responded ${response.status} ${await response.text()}`);
      return null;
    }
    const payload = (await response.json()) as { content?: Array<{ type?: string; text?: string }> };
    const translated = payload.content?.find((block) => block.type === "text")?.text?.trim();
    if (!translated) return null;

    return { text: translated, provider: "claude", qualitySignal: "provider-confirmed" };
  } catch (error) {
    // Every failure here degrades silently to "Translation unavailable." for the
    // learner (see learn/page.tsx) with no other signal — without this log, a
    // persistently wrong API key, model name, or network block is
    // indistinguishable from CLAUDE_API_KEY simply not being set.
    console.error("translateWithClaude failed:", error);
    return null;
  }
}

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
    try {
      const { text: translated } = await localTranslate(text, sourceLanguage, targetLanguage);
      if (translated) return { text: translated, provider: "nllb", qualitySignal: "provider-confirmed" };
    } catch (error) {
      // Fall through to the cloud tier below (or to null, if disallowed) — but log
      // first, or a broken local-inference tier is invisible until someone notices
      // every segment quietly reads "Translation unavailable.".
      console.error("translateText: local-inference translate failed, falling back:", error);
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
