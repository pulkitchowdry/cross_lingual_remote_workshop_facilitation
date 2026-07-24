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

function getServerSnapshot(): SupportedLanguage {
  return "en";
}

/**
 * Reads the interface language of whichever page is currently mounted (each page sets
 * `data-ui-lang` via `SyncUiLanguage` from its own known session/participant/searchParams
 * language). Lets global chrome (nav, accessibility panel, theme toggle) stay in the same
 * language as the page around it without prop-drilling through the root layout.
 */
export function useUiLanguage(): SupportedLanguage {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
