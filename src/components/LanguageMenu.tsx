"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
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
  slotId = HEADER_SLOT_ID,
}: {
  current: SupportedLanguage;
  languages?: readonly { value: SupportedLanguage; nativeLabel: string }[];
  onSelect: (lang: SupportedLanguage) => Promise<void>;
  /** Portal target id — defaults to AppShell's header slot. The meeting room's own
   * header (hidden behind AppShell's, since the room takes over the full viewport)
   * passes its own local slot id instead. */
  slotId?: string;
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
    setSlot(document.getElementById(slotId));
  }, [slotId]);
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const dict = getDictionary(current).shell;
  // Which option is highlighted — the thing `aria-activedescendant` points at and arrow
  // keys move. Kept separate from `current` because a keyboard user can arrow through
  // options without selecting any of them (selection only commits on Enter/Space/click).
  const [activeIndex, setActiveIndex] = useState(0);
  // Scopes option ids to this instance — the menu is portalled into a shared header
  // slot, so a plain per-language id would collide if two instances ever mounted.
  const listboxId = useId();
  const optionId = (value: SupportedLanguage) => `${listboxId}-option-${value}`;
  // `languages` is caller-supplied (the learn page filters it down to a session's
  // configured learner languages) and could in principle be empty, unlike the
  // fixed, non-empty `SUPPORTED_LANGUAGES` default — guard the lookup (`.at` types as
  // possibly-`undefined`) rather than assume `activeIndex` always indexes something.
  const activeLanguage = languages.at(activeIndex);

  useEffect(() => {
    if (!open) return;
    // Re-highlight whichever option matches the active language every time the menu
    // opens, so arrow-key navigation and aria-activedescendant both start from where
    // selection actually is instead of always resetting to the first option. This reacts
    // to `open` flipping true (an external, DOM-focus-adjacent event, not a value
    // derivable during render), the same justification as the `setSlot` effect above.
    const currentIndex = languages.findIndex((language) => language.value === current);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveIndex(currentIndex === -1 ? 0 : currentIndex);
    // Move focus onto the listbox itself, not an option — per the WAI-ARIA listbox
    // pattern, real DOM focus stays on the list and the highlighted option is tracked
    // virtually via `aria-activedescendant` (set on the list below), so a keyboard user
    // who opens the menu lands somewhere that's actually announced and behaves like the
    // listbox it claims to be.
    listRef.current?.focus();

    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      // Only Escape (and selecting an option, in `selectLanguage` below) return focus to
      // the trigger — an outside pointerdown closes the menu but deliberately leaves
      // focus wherever the user actually clicked, not wherever the menu used to be.
      triggerRef.current?.focus();
    }
    // Tabbing away is a keyboard-only exit that neither `handlePointerDown` (no mouse
    // event fires) nor `handleKeyDown` (Tab isn't Escape) catches, so without this the
    // listbox would stay open — and `aria-expanded` stuck `true` — after focus moves on.
    // `focusout` bubbles (unlike `blur`), so listening on the container catches focus
    // leaving any descendant. Check `relatedTarget` (the element gaining focus) against
    // the container so Tabbing *within* the menu (e.g. into the listbox itself) doesn't
    // prematurely close it — mirrors `handlePointerDown`'s outside-target check above.
    function handleFocusOut(event: FocusEvent) {
      if (containerRef.current && !containerRef.current.contains(event.relatedTarget as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    containerRef.current?.addEventListener("focusout", handleFocusOut);
    const container = containerRef.current;
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      container?.removeEventListener("focusout", handleFocusOut);
    };
  }, [open, current, languages]);

  // WAI-ARIA listbox keyboard pattern: arrows/Home/End move the highlighted option
  // (clamped, not wrapping — matches the APG reference listbox), Enter/Space commit
  // whatever `aria-activedescendant` is currently pointing at. Escape is handled by the
  // document-level listener above, not here.
  function handleListKeyDown(event: React.KeyboardEvent<HTMLUListElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((index) => Math.min(index + 1, languages.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((index) => Math.max(index - 1, 0));
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(languages.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (activeLanguage) selectLanguage(activeLanguage.value);
        break;
      default:
        break;
    }
  }

  function selectLanguage(lang: SupportedLanguage) {
    setOpen(false);
    triggerRef.current?.focus();
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
        ref={triggerRef}
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
          ref={listRef}
          role="listbox"
          aria-label={dict.interfaceLanguage}
          tabIndex={0}
          aria-activedescendant={activeLanguage ? optionId(activeLanguage.value) : undefined}
          onKeyDown={handleListKeyDown}
          className="absolute right-0 top-full z-50 mt-1 min-w-[9rem] overflow-hidden rounded-md border border-border-strong bg-surface-raised py-1 shadow-lg outline-none focus:ring-2 focus:ring-accent/30"
        >
          {languages.map((language, index) => (
            <li
              key={language.value}
              id={optionId(language.value)}
              role="option"
              aria-selected={language.value === current}
            >
              <button
                type="button"
                tabIndex={-1}
                onClick={() => selectLanguage(language.value)}
                className={`font-data flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium uppercase tracking-wider transition-colors ${
                  language.value === current
                    ? "bg-accent/10 text-foreground"
                    : "text-muted-foreground hover:bg-accent/10 hover:text-foreground"
                } ${index === activeIndex ? "ring-2 ring-inset ring-accent/30" : ""}`}
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
