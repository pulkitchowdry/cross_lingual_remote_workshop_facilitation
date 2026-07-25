"use client";

import { useEffect } from "react";
import { useUiLanguage } from "@/lib/use-ui-language";
import { getDictionary } from "@/lib/i18n";

/**
 * Shared UI for this app's `error.tsx` boundaries. `sendChatMessage`/`publishCaption`
 * (and other server actions) model expected validation failures as thrown `Error`s
 * rather than a `useActionState`-returned value — with no boundary anywhere in the
 * tree, that meant even a routine failure (a session that ended moments ago, a
 * whitespace-only message that passes the textarea's `required` check) crashed the
 * *entire* page — video call, captions, chat, everything — instead of showing a
 * small, recoverable, inline notice. `error.message` is shown when Next actually
 * hands the client the real thrown message; the localized fallback below covers the
 * case where it's redacted/empty instead.
 *
 * The retry button calls `unstable_retry()` rather than `reset()`: `reset()` only clears
 * this boundary's local error flag and re-renders whatever was already fetched pre-crash,
 * so a "session that ended moments ago" error would just resurface immediately. `unstable_retry()`
 * (added in Next 16.2, see `error.js` docs) also triggers a router refresh that re-fetches this
 * segment's data before re-rendering, which is what actually gives the retry a chance to succeed.
 */
export function RouteErrorFallback({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const lang = useUiLanguage();
  const dict = getDictionary(lang).error;

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-3 py-16 text-center">
      <h1 className="font-heading text-xl font-semibold">{dict.title}</h1>
      <p className="text-sm text-muted-foreground">{error.message || dict.message}</p>
      <button
        type="button"
        onClick={unstable_retry}
        className="font-data w-fit rounded-md bg-accent-fill px-5 py-2 text-xs font-medium uppercase tracking-wider text-accent-foreground"
      >
        {dict.retry}
      </button>
    </div>
  );
}
