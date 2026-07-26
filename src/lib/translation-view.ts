/**
 * Shared "which text do I show this viewer" resolution for anything shaped like a
 * transcript segment or chat message (original text + per-target-language translations).
 * Existing pages (facilitator/learn) each hand-roll this ternary inline; new meeting-shell
 * surfaces (CaptionOverlay, TranslationHistoryTab) share this instead of a 4th copy.
 */
export interface TranslatableItem {
  language: string;
  originalText: string;
  translations: Array<{ targetLanguage: string; text: string }>;
}

export interface ResolvedTranslation {
  text: string;
  lang: string;
  isOriginal: boolean;
  hasTranslation: boolean;
}

export function resolveTranslatedText(item: TranslatableItem, viewerLanguage: string): ResolvedTranslation {
  if (item.language === viewerLanguage) {
    return { text: item.originalText, lang: item.language, isOriginal: true, hasTranslation: true };
  }
  const translation = item.translations.find((entry) => entry.targetLanguage === viewerLanguage);
  if (translation) {
    return { text: translation.text, lang: viewerLanguage, isOriginal: false, hasTranslation: true };
  }
  return { text: "", lang: "en", isOriginal: false, hasTranslation: false };
}
