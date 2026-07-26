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

/** A rate limit or transient server error is exactly the kind of blip a live
 * workshop's network sees constantly (a flaky wifi hop, a VPN/proxy hiccup, Claude
 * momentarily overloaded) — worth one retry, since it turns that into a normal
 * translation instead of a permanent "Translation unavailable." for that one
 * message. A 4xx other than 429 (bad request, revoked key) won't succeed on
 * retry, so don't waste the extra round-trip on it. */
const CLAUDE_MAX_ATTEMPTS = 2;
const CLAUDE_RETRY_DELAY_MS = 400;

function isTransientClaudeStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** sendChatMessage/publishCaption fan out one translateText call per target language via
 * Promise.all, all sharing the same Claude API key — if Claude 429s all of them in the
 * same brief rate-limit window, a fixed retry delay would just retry every one of them
 * in lockstep and hit that same window again. Jittering the delay (half the base to 1.5x
 * the base, same ~400ms order of magnitude) spreads concurrent retries out instead. */
function claudeRetryDelayMs(): number {
  return CLAUDE_RETRY_DELAY_MS / 2 + Math.random() * CLAUDE_RETRY_DELAY_MS;
}

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

  for (let attempt = 1; attempt <= CLAUDE_MAX_ATTEMPTS; attempt++) {
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
          // Raised from 1024: a routine multi-sentence caption/chat message (up to the
          // UI's own 3000-character maxLength) translated into a token-denser target
          // language can need more than 1024 output tokens — Claude would silently stop
          // generating mid-sentence at the cap (stop_reason: "max_tokens") rather than
          // erroring, and the code below used to return that partial text as a normal,
          // complete translation with no signal anything was cut off.
          max_tokens: 4096,
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
        if (isTransientClaudeStatus(response.status) && attempt < CLAUDE_MAX_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, claudeRetryDelayMs()));
          continue;
        }
        return null;
      }
      const payload = (await response.json()) as {
        content?: Array<{ type?: string; text?: string }>;
        stop_reason?: string;
      };
      const translated = payload.content?.find((block) => block.type === "text")?.text?.trim();
      if (!translated) return null;

      // A truncated translation is still more useful to a learner than none at all, so
      // this returns the (possibly partial) text rather than degrading to null — but
      // log loudly, or a translation getting silently cut off mid-sentence is
      // indistinguishable from a normal short one until someone happens to notice.
      if (payload.stop_reason === "max_tokens") {
        console.error(
          `translateWithClaude: ${sourceLanguage}->${targetLanguage} translation was truncated at the max_tokens cap.`,
        );
      }

      return { text: translated, provider: "claude", qualitySignal: "provider-confirmed" };
    } catch (error) {
      // Every failure here degrades silently to "Translation unavailable." for the
      // learner (see learn/page.tsx) with no other signal — without this log, a
      // persistently wrong API key, model name, or network block is
      // indistinguishable from CLAUDE_API_KEY simply not being set.
      console.error(`translateWithClaude failed (attempt ${attempt}/${CLAUDE_MAX_ATTEMPTS}):`, error);
      if (attempt < CLAUDE_MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, claudeRetryDelayMs()));
        continue;
      }
      return null;
    }
  }
  return null;
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
        // localTranslate only throws when payload.text isn't a string (handled in the catch
        // below) — an empty string passes that check and lands here instead. Without this
        // log, a local-inference tier that responds 200 with a blank body is indistinguishable
        // from one that's simply not configured. Not retried: a 200 with blank text is a
        // content problem, not the kind of transient failure the retry loop targets.
        console.error(
          `[translation] local-inference returned an empty translation (${sourceLanguage}->${targetLanguage}), falling back.`,
        );
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
