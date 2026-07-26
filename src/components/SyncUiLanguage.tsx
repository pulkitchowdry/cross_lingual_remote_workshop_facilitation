"use client";

import { useEffect } from "react";
import { UI_LANGUAGE_CHANGE_EVENT } from "@/lib/i18n";
import type { SupportedLanguage } from "@/lib/session-contracts";

/**
 * Runs once, synchronously, as the browser parses the initial HTML — same mechanism as
 * `THEME_INIT_SCRIPT` in `src/app/layout.tsx` (see that file for why a plain inline
 * `<script>`, not `next/script`, is what actually runs before paint under the App
 * Router, and why the resulting dev-only "Encountered a script tag" warning is filtered
 * rather than "fixed"). Stamps `data-ui-lang`/`<html lang>` with the page's real,
 * already-known-server-side language *before* React hydrates, so `useUiLanguage`'s
 * `useSyncExternalStore` (see `use-ui-language.ts`) picks up the correct value on its
 * very first post-hydration check instead of only correcting after the `useEffect`
 * below has had a chance to run (which happens post-paint) — that gap used to show a
 * flash of English shell chrome (nav, accessibility panel, theme toggle) on every
 * zh/es session. `getServerSnapshot` itself still can't know per-request language
 * during actual SSR (no request-scoped mechanism for it), so the raw SSR HTML for
 * shared chrome is still English; this script is what corrects it before anyone sees it.
 */
function langInitScript(lang: SupportedLanguage): string {
  const json = JSON.stringify(lang);
  return `document.documentElement.setAttribute("data-ui-lang", ${json});document.documentElement.lang = ${json};`;
}

/**
 * Renders the pre-paint script above plus (on mount, and whenever `lang` changes) an
 * effect that keeps `data-ui-lang`/`<html lang>` in sync at *runtime* — e.g. `LanguageMenu`
 * changing the session/participant language server-side and calling `router.refresh()`,
 * which re-renders this component with a new `lang` prop without a full page reload. The
 * inline script only executes once, on its first mount (browsers don't re-run a `<script>`
 * element just because its content is updated in place), so this effect is still required
 * for every language change after the initial paint. Each page passes its own
 * already-known language (session/participant/searchParams), so no client-side language
 * detection is needed here.
 */
export function SyncUiLanguage({ lang }: { lang: SupportedLanguage }) {
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.setAttribute("data-ui-lang", lang);
    window.dispatchEvent(new Event(UI_LANGUAGE_CHANGE_EVENT));
  }, [lang]);

  return <script dangerouslySetInnerHTML={{ __html: langInitScript(lang) }} />;
}
