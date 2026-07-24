import Link from "next/link";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/lib/session-contracts";
import { getDictionary } from "@/lib/i18n";

const NATIVE_NAME: Record<SupportedLanguage, string> = { en: "English", zh: "中文", es: "Español" };

/**
 * Plain `<Link>`s with a `?lang=` query param, not client state — setup/join are Server
 * Components with no session yet to derive a language from, so the interface language here
 * has to come from somewhere the server can read on the next request. Labels are always
 * shown in each language's own autonym (not translated) — the standard convention for
 * language pickers, since a reader who doesn't yet know the current UI language still needs
 * to recognize their own.
 */
export function LanguageSwitcher({ current, basePath }: { current: SupportedLanguage; basePath: string }) {
  const label = getDictionary(current).shell.interfaceLanguage;
  return (
    <div className="flex items-center gap-2" role="group" aria-label={label}>
      {SUPPORTED_LANGUAGES.map((language) => (
        <Link
          key={language.value}
          href={`${basePath}?lang=${language.value}`}
          aria-current={language.value === current ? "true" : undefined}
          className={`font-data rounded-md border px-2.5 py-1 text-[0.6875rem] font-medium uppercase tracking-wider transition-colors ${
            language.value === current
              ? "border-accent text-foreground"
              : "border-border-strong text-muted-foreground hover:border-accent hover:text-foreground"
          }`}
        >
          {NATIVE_NAME[language.value]}
        </Link>
      ))}
    </div>
  );
}
