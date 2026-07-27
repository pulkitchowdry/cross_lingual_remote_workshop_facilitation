"use client";

import { useEffect, useRef } from "react";
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
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    console.error(error);
    // The crashed subtree (whatever held focus before this boundary tripped) is
    // unmounted and replaced by this fallback — without moving focus here, it
    // silently drops to <body> and a screen-reader user gets no announcement
    // that an error occurred or that a heading/retry button now exists.
    headingRef.current?.focus();
  }, [error]);

  // Next redacts a production Server Component error's real message for security, but
  // replaces it with a non-empty, generic, English string (not "" as `error.message ||
  // dict.message` below assumed) — verified against Next's own react-server-dom runtime:
  // "An error occurred in the Server Components render. The specific message is omitted
  // in production builds to avoid leaking sensitive details. A digest property is
  // included on this error instance which may provide additional details about the
  // nature of the error." Being truthy, that string always won the `||` fallback, so a
  // non-English-speaking facilitator/learner — this app's whole purpose — saw raw
  // English Next.js internals instead of `dict.message` in exactly the real-world case
  // (a genuine backend failure) where a localized, reassuring message matters most.
  const isRedactedMessage = error.message?.startsWith("An error occurred in the Server Components render");
  // createSession/joinSession (setup/actions.ts, join/[token]/actions.ts) throw plain,
  // hardcoded-English `Error`s for their *expected* validation/lifecycle failures (rate
  // limiting, a revoked/expired invite, a session that just ended) rather than a
  // translated `FormActionResult` — look up a localized replacement for the ones a
  // learner/facilitator can realistically hit before falling back to the raw message.
  const knownTranslation = error.message ? dict.knownMessages[error.message] : undefined;
  const displayMessage = isRedactedMessage ? dict.message : knownTranslation || error.message || dict.message;

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-3 py-16 text-center">
      <h1 ref={headingRef} tabIndex={-1} className="font-heading text-xl font-semibold">
        {dict.title}
      </h1>
      <p className="text-sm text-muted-foreground">{displayMessage}</p>
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
