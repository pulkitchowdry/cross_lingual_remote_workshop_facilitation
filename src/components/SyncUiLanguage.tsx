"use client";

import { useEffect } from "react";
import { UI_LANGUAGE_CHANGE_EVENT } from "@/lib/i18n";
import type { SupportedLanguage } from "@/lib/session-contracts";

/**
 * Renders nothing — on mount (and whenever `lang` changes), sets the document's real
 * `lang` attribute so screen readers use the right pronunciation/voice for this page's
 * content, and stamps `data-ui-lang` so global chrome (see `useUiLanguage`) matches it.
 * Each page passes its own already-known language (session/participant/searchParams),
 * so no client-side language detection is needed here.
 */
export function SyncUiLanguage({ lang }: { lang: SupportedLanguage }) {
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.setAttribute("data-ui-lang", lang);
    window.dispatchEvent(new Event(UI_LANGUAGE_CHANGE_EVENT));
  }, [lang]);

  return null;
}
