import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { getDictionary } from "@/lib/i18n";

/**
 * Covers both an explicit `notFound()` call (invalid/expired/revoked join links — the
 * common real-world case, since those links are shared outside the app) and any
 * unmatched URL. Renders through the root layout, so nav/theme/accessibility chrome is
 * still present instead of the framework's unbranded default. Language is fixed to
 * English: `not-found.js` receives no props (no searchParams, no session to read).
 */
export default function NotFound() {
  const dict = getDictionary("en").notFound;

  return (
    <div className="flex flex-col items-start gap-4">
      <p className="font-data text-xs font-medium uppercase tracking-wider text-muted-foreground">404</p>
      <h1 className="font-heading text-2xl font-semibold">{dict.title}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{dict.message}</p>
      <Link href="/setup">
        <Button type="button">{dict.cta}</Button>
      </Link>
    </div>
  );
}
