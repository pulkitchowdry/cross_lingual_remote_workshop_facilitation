"use client";

import { useSyncExternalStore } from "react";

type Theme = "dark" | "light";

const THEME_CHANGE_EVENT = "theme-change";

function subscribe(callback: () => void) {
  window.addEventListener(THEME_CHANGE_EVENT, callback);
  return () => window.removeEventListener(THEME_CHANGE_EVENT, callback);
}

function getSnapshot(): Theme {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

function getServerSnapshot(): Theme {
  return "dark";
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
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
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      className="font-data ml-auto flex items-center gap-1.5 rounded-md border border-border-strong px-2.5 py-1 text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:border-accent hover:text-foreground"
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: theme === "dark" ? "var(--accent)" : "var(--tick-high)" }}
        aria-hidden="true"
      />
      {theme === "dark" ? "Dark" : "Light"}
    </button>
  );
}
