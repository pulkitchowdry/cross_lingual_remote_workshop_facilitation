import Link from "next/link";
import { headers } from "next/headers";
import { Button } from "@/components/ui/Button";
import { SyncUiLanguage } from "@/components/SyncUiLanguage";
import { detectBrowserLanguage, getDictionary } from "@/lib/i18n";

/**
 * Covers both an explicit `notFound()` call (invalid/expired/revoked join links — the
 * common real-world case, since those links are shared outside the app) and any
 * unmatched URL. Renders through the root layout, so nav/theme/accessibility chrome is
 * still present instead of the framework's unbranded default. `not-found.js` receives no
 * props (no searchParams, no session to read) — but it's still an async Server Component,
 * so we can read `headers()` the same way setup/join resolve their first-visit default
 * (see `detectBrowserLanguage`), instead of hardcoding English. `SyncUiLanguage` keeps
 * `<html lang>` and the root nav in sync with that resolved language, since the root
 * layout's own guess (see `layout.tsx`) is only a pre-hydration heuristic that can't see
 * this page's actual choice.
 */
export default async function NotFound() {
  const lang = detectBrowserLanguage((await headers()).get("accept-language"));
  const dict = getDictionary(lang).notFound;

  return (
    <div className="flex animate-fade-in flex-col items-start gap-4">
      <SyncUiLanguage lang={lang} />
      <p className="font-data text-xs font-medium uppercase tracking-wider text-muted-foreground">404</p>
      <h1 className="font-heading text-2xl font-semibold">{dict.title}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{dict.message}</p>
      <Link href="/setup">
        <Button type="button">{dict.cta}</Button>
      </Link>
    </div>
  );
}
