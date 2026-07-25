"use client";

import { useSyncExternalStore } from "react";
import { getDictionary } from "@/lib/i18n";
import { useUiLanguage } from "@/lib/use-ui-language";
import { DEFAULT_THEME, isThemeName, nextTheme, type ThemeName } from "@/lib/theme-preferences";

const THEME_CHANGE_EVENT = "theme-change";

function subscribe(callback: () => void) {
  window.addEventListener(THEME_CHANGE_EVENT, callback);
  return () => window.removeEventListener(THEME_CHANGE_EVENT, callback);
}

function getSnapshot(): ThemeName {
  const attr = document.documentElement.getAttribute("data-theme");
  return isThemeName(attr) ? attr : DEFAULT_THEME;
}

function getServerSnapshot(): ThemeName {
  return DEFAULT_THEME;
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const dict = getDictionary(useUiLanguage()).a11y;

  function toggle() {
    const next = nextTheme(theme);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      // storage unavailable (private browsing) — theme still applies for this load
    }
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dict.themeAriaLabel(dict.themeNames[nextTheme(theme)])}
      className="font-data flex items-center gap-1.5 rounded-md border border-border-strong px-2.5 py-1 text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:border-accent hover:text-foreground"
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: "var(--accent)" }}
        aria-hidden="true"
      />
      {dict.themeNames[theme]}
    </button>
  );
}
