"use client";

import { useSyncExternalStore } from "react";
import { resolveLanguage, UI_LANGUAGE_CHANGE_EVENT } from "@/lib/i18n";
import type { SupportedLanguage } from "@/lib/session-contracts";

function subscribe(callback: () => void) {
  window.addEventListener(UI_LANGUAGE_CHANGE_EVENT, callback);
  return () => window.removeEventListener(UI_LANGUAGE_CHANGE_EVENT, callback);
}

function getSnapshot(): SupportedLanguage {
  return resolveLanguage(document.documentElement.getAttribute("data-ui-lang"));
}

// Genuinely matches what the server renders for shared chrome: AppShell/ThemeToggle/
// AccessibilityPanel/LanguageMenu have no access to a nested page's server-computed
// `lang` (no per-request context threads it down to them), so their actual SSR output
// for a zh/es session's chrome IS English — lying here would only trade a real
// server/client mismatch for a hydration-mismatch warning instead of fixing anything.
// The flash this used to cause is now avoided a different way: `SyncUiLanguage` (see
// that file) renders a pre-paint inline `<script>`, mirroring `THEME_INIT_SCRIPT` in
// `src/app/layout.tsx`, that stamps the *real* `data-ui-lang` onto `<html>` while the
// browser is still parsing the initial HTML — before React ever hydrates. Because
// `useSyncExternalStore` re-checks `getSnapshot()` against the live DOM immediately on
// mount (synchronously, ahead of paint), `getSnapshot()` below already sees the correct
// attribute value by the time that check runs, so the corrected language is what
// actually paints — this `getServerSnapshot` fallback is only ever visible to the
// (increasingly theoretical) no-JS case, where no script runs to correct it at all.
function getServerSnapshot(): SupportedLanguage {
  return "en";
}

/**
 * Reads the interface language of whichever page is currently mounted (each page sets
 * `data-ui-lang` via `SyncUiLanguage` from its own known session/participant/searchParams
 * language — see that file for how it's stamped pre-paint, not just post-mount). Lets
 * global chrome (nav, accessibility panel, theme toggle) stay in the same language as the
 * page around it without prop-drilling through the root layout.
 */
export function useUiLanguage(): SupportedLanguage {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
