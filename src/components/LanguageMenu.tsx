"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/lib/session-contracts";
import { getDictionary } from "@/lib/i18n";

const HEADER_SLOT_ID = "header-language-slot";

/**
 * Dropdown for changing language after joining a live session, where the language is
 * stored server-side (participant/session row) rather than in the URL — unlike
 * `LanguageSwitcher`'s plain `?lang=` links, selecting an option here calls a server
 * action and refreshes the route so the new language actually takes effect. Portals its
 * button into AppShell's `#header-language-slot` so it renders next to the theme toggle
 * regardless of which page (facilitator/learn) actually owns the language state.
 */
export function LanguageMenu({
  current,
  languages = SUPPORTED_LANGUAGES,
  onSelect,
}: {
  current: SupportedLanguage;
  languages?: readonly { value: SupportedLanguage; nativeLabel: string }[];
  onSelect: (lang: SupportedLanguage) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  // Deliberately `useState(null)` + an effect below, not a lazy initializer — a lazy
  // initializer runs during render, including the client's *hydration* render, where
  // `document.getElementById` already finds the slot AppShell server-rendered. That
  // makes the client's first render produce a portal while the server (which has no
  // `document` at all) produced nothing for this component, a real server/client
  // output mismatch React's hydration diffing flags. Starting at `null` and only
  // looking the slot up in an effect (client-only, always runs after hydration,
  // never during it) keeps the client's hydration-time render matching the server's
  // (both render nothing) — the portal then mounts on the very next, ordinary
  // client-side re-render, which hydration doesn't apply to.
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    // Reads from `document` (an external system, not derivable during render without
    // reintroducing the hydration mismatch this effect exists to avoid — see the
    // comment above) and stores the result; it isn't state that could be computed
    // during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSlot(document.getElementById(HEADER_SLOT_ID));
  }, []);
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const dict = getDictionary(current).shell;

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function selectLanguage(lang: SupportedLanguage) {
    setOpen(false);
    if (lang === current) return;
    startTransition(async () => {
      await onSelect(lang);
      router.refresh();
    });
  }

  if (!slot) return null;

  return createPortal(
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={dict.interfaceLanguage}
        disabled={isPending}
        className="font-data flex items-center gap-1.5 rounded-md border border-border-strong px-2.5 py-1 text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:border-accent hover:text-foreground disabled:opacity-60"
      >
        <TranslateIcon />
        {dict.language}
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label={dict.interfaceLanguage}
          className="absolute right-0 top-full z-50 mt-1 min-w-[9rem] overflow-hidden rounded-md border border-border-strong bg-surface-raised py-1 shadow-lg"
        >
          {languages.map((language) => (
            <li key={language.value} role="option" aria-selected={language.value === current}>
              <button
                type="button"
                onClick={() => selectLanguage(language.value)}
                className={`font-data flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium uppercase tracking-wider transition-colors ${
                  language.value === current
                    ? "bg-accent/10 text-foreground"
                    : "text-muted-foreground hover:bg-accent/10 hover:text-foreground"
                }`}
              >
                {language.nativeLabel}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>,
    slot,
  );
}

function TranslateIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3.5 5.5h8M7.5 3.5v2M4 8.5c.9 2.4 2.6 4.3 5 5.8M11 8.5c-.9 2.4-2.6 4.6-5 6.3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13.5 20.5l3.75-9.5 3.75 9.5M14.6 17.5h5.3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
