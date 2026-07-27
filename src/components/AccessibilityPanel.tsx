"use client";

import { useSyncExternalStore } from "react";
import {
  isContrastMode,
  isFontSize,
  nextFontSize,
  toggleContrastMode,
  type ContrastMode,
  type FontSize,
} from "@/lib/accessibility-preferences";
import { getDictionary } from "@/lib/i18n";
import { useUiLanguage } from "@/lib/use-ui-language";

const PREFERENCE_CHANGE_EVENT = "accessibility-preference-change";

function subscribe(callback: () => void) {
  window.addEventListener(PREFERENCE_CHANGE_EVENT, callback);
  return () => window.removeEventListener(PREFERENCE_CHANGE_EVENT, callback);
}

function getFontSizeSnapshot(): FontSize {
  const attr = document.documentElement.getAttribute("data-font-size");
  return isFontSize(attr) ? attr : "normal";
}

function getContrastSnapshot(): ContrastMode {
  const attr = document.documentElement.getAttribute("data-contrast");
  return isContrastMode(attr) ? attr : "standard";
}

function getServerFontSize(): FontSize {
  return "normal";
}

function getServerContrast(): ContrastMode {
  return "standard";
}

function persist(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable (private browsing) — preference still applies for this load
  }
}

/**
 * Minimal accessibility settings surface (font size + high-contrast mode),
 * following the same pre-paint data-attribute + localStorage pattern as
 * ThemeToggle so preferences survive reloads with no flash of unstyled
 * content. Applies globally (facilitator and learner views both render
 * AppShell), matching the "consider accessibility" requirement in
 * docs/problem_statement.md.
 */
export function AccessibilityPanel() {
  const fontSize = useSyncExternalStore(subscribe, getFontSizeSnapshot, getServerFontSize);
  const contrast = useSyncExternalStore(subscribe, getContrastSnapshot, getServerContrast);
  const dict = getDictionary(useUiLanguage()).a11y;

  function cycleFontSize() {
    const next = nextFontSize(fontSize);
    document.documentElement.setAttribute("data-font-size", next);
    persist("accessibility-font-size", next);
    window.dispatchEvent(new Event(PREFERENCE_CHANGE_EVENT));
  }

  function toggleContrast() {
    const next = toggleContrastMode(contrast);
    document.documentElement.setAttribute("data-contrast", next);
    persist("accessibility-contrast", next);
    window.dispatchEvent(new Event(PREFERENCE_CHANGE_EVENT));
  }

  return (
    // Fixed px sizing throughout this cluster (not rem-based Tailwind defaults) is
    // deliberate: `data-font-size` rescales the root font-size so every rem unit on the
    // page grows, this cluster included — without pinning it to px, growing text size
    // (via the very "Aa" button here) reflows this row and shifts the Contrast/Theme/
    // Language buttons sideways right under the cursor that just clicked "Aa", so the
    // next click lands on a neighboring control instead. Reading content still scales
    // normally; only this persistent header chrome stays a fixed size.
    <div className="flex items-center gap-[8px]">
      <button
        type="button"
        onClick={cycleFontSize}
        aria-label={dict.textSizeAriaLabel(dict.fontSizeLabel[fontSize])}
        className="font-data flex items-center gap-[6px] whitespace-nowrap rounded-md border border-border-strong px-[10px] py-[4px] text-[11px] font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:border-accent hover:text-foreground"
      >
        Aa
      </button>
      <button
        type="button"
        onClick={toggleContrast}
        aria-pressed={contrast === "high"}
        aria-label={dict.contrastAriaLabel(contrast)}
        className="font-data flex items-center gap-[6px] whitespace-nowrap rounded-md border border-border-strong px-[10px] py-[4px] text-[11px] font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:border-accent hover:text-foreground"
      >
        <span
          className="h-[6px] w-[6px] rounded-full"
          style={{ background: contrast === "high" ? "var(--accent)" : "var(--muted-foreground)" }}
          aria-hidden="true"
        />
        {dict.contrastLabel}
      </button>
    </div>
  );
}
