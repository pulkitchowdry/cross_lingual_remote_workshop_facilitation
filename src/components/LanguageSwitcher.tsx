import Link from "next/link";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/lib/session-contracts";
import { getDictionary } from "@/lib/i18n";

/**
 * Plain `<Link>`s with a `?lang=` query param, not client state — setup/join are Server
 * Components with no session yet to derive a language from, so the interface language here
 * has to come from somewhere the server can read on the next request. Labels are always
 * shown in each language's own autonym (not translated) — the standard convention for
 * language pickers, since a reader who doesn't yet know the current UI language still needs
 * to recognize their own.
 */
export function LanguageSwitcher({
  current,
  basePath,
  languages = SUPPORTED_LANGUAGES,
  ariaLabel,
}: {
  current: SupportedLanguage;
  basePath: string;
  languages?: readonly { value: SupportedLanguage; nativeLabel: string }[];
  /**
   * Overrides the default "Interface language" group label — the join page passes its
   * own `join.languagePickerLabel` here, since on that page this same control also picks
   * the learner's caption/translation language, which the generic default doesn't convey.
   */
  ariaLabel?: string;
}) {
  const label = ariaLabel ?? getDictionary(current).shell.interfaceLanguage;
  return (
    // Fixed px sizing, not rem-based Tailwind defaults — this switcher renders in the
    // same header row as the font-size toggle on setup/join pages, so it needs to stay
    // immune to the font-size preference it sits beside (see AccessibilityPanel.tsx's
    // matching comment) instead of reflowing and shifting sideways when text size changes.
    <div className="flex items-center gap-[8px]" role="group" aria-label={label}>
      {languages.map((language) => (
        <Link
          key={language.value}
          href={`${basePath}?lang=${language.value}`}
          aria-current={language.value === current ? "true" : undefined}
          className={`font-data press-scale rounded-md border px-[10px] py-[4px] text-[11px] font-medium uppercase tracking-wider transition-colors duration-150 ${
            language.value === current
              ? "border-accent text-foreground"
              : "border-border-strong text-muted-foreground hover:border-accent hover:text-foreground"
          }`}
        >
          {language.nativeLabel}
        </Link>
      ))}
    </div>
  );
}
