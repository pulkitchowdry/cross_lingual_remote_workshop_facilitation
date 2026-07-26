"use client";

import { useEffect, useId, useRef } from "react";
import { useFormStatus } from "react-dom";

/**
 * A submit button for a consequential, hard-to-undo server action (ending a
 * live session, revoking an invite link) — clicking it opens a native
 * `<dialog>` asking for an explicit second confirmation before the
 * surrounding `<form>` actually submits, instead of firing immediately.
 * `<dialog>` (not a hand-rolled overlay) for its built-in modal semantics:
 * focus trapping, Escape-to-dismiss, and a `::backdrop` — all free.
 *
 * Deliberately submits the real form via `requestSubmit()` from a plain
 * button click, rather than nesting a second `<form>` inside the dialog —
 * `<form>` elements can't nest, and the dialog itself lives inside the
 * server-action form this button belongs to.
 */
export function ConfirmSubmitButton({
  label,
  pendingLabel,
  title,
  body,
  confirmLabel,
  cancelLabel,
  variant = "default",
}: {
  label: string;
  pendingLabel: string;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  /** "danger" tints the trigger + confirm action for a destructive/irreversible action (e.g. ending a session). */
  variant?: "default" | "danger";
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { pending } = useFormStatus();
  // Two of these can render on one page (facilitator/page.tsx's End Session AND
  // Revoke Invite Link) — a stable-but-unique id per instance so aria-labelledby/
  // aria-describedby each point at THIS dialog's own title/body, not the other one's.
  const titleId = useId();
  const bodyId = useId();

  const confirm = () => {
    dialogRef.current?.close();
    buttonRef.current?.closest("form")?.requestSubmit();
  };

  // Closing the native <dialog> restores focus to the trigger button (the browser's own
  // default `close()` behavior) — but confirming immediately disables that same button
  // via `pending` below, and a disabled element can't hold focus, so the browser drops
  // focus to <body> with nothing to restore it. Once the action completes, the
  // surrounding conditional branch this button lives in (session LIVE -> ENDED, or an
  // active invite link -> revoked) unmounts entirely either way — a stable-looking
  // wrapper *inside* this component would just get unmounted right along with it, so
  // there's no in-place element here worth focusing instead. `#main-content` (AppShell's
  // own landmark, already a valid focus target for its "Skip to main content" link) is
  // the one thing guaranteed to survive any of these content swaps — confirmed live:
  // without this, a keyboard user who just confirmed "End session" landed on <body> with
  // no way back in except tabbing from the very top of the page.
  useEffect(() => {
    if (pending) document.getElementById("main-content")?.focus();
  }, [pending]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={pending}
        aria-disabled={pending}
        onClick={() => dialogRef.current?.showModal()}
        className={`font-data w-fit rounded-md border px-5 py-2 text-xs font-medium uppercase tracking-wider transition-colors disabled:opacity-40 ${
          variant === "danger"
            ? "border-border-strong text-foreground hover:border-[var(--tick-low)] hover:text-[var(--tick-low)]"
            : "border-border-strong text-foreground hover:bg-background"
        }`}
      >
        {pending ? pendingLabel : label}
      </button>
      <dialog
        ref={dialogRef}
        role="alertdialog"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        // `fixed inset-0 m-auto` restores the browser's native centering for an
        // open <dialog> (normally `margin: auto` from the UA stylesheet) — Tailwind's
        // preflight resets margin to 0 on every element, which otherwise leaves the
        // dialog pinned to the top-left corner instead of centered on screen.
        className="fixed inset-0 m-auto w-[min(26rem,90vw)] rounded-lg border border-border-strong bg-surface-raised p-0 text-foreground backdrop:bg-black/60"
      >
        <div className="flex flex-col gap-4 p-5">
          <div>
            <p id={titleId} className="font-heading text-base font-semibold">{title}</p>
            <p id={bodyId} className="mt-1 text-sm text-muted-foreground">{body}</p>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="font-data rounded-md border border-border-strong px-4 py-2 text-xs font-medium uppercase tracking-wider text-foreground hover:bg-background"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={confirm}
              className="font-data rounded-md px-4 py-2 text-xs font-medium uppercase tracking-wider text-white"
              // --tick-low/--accent are tuned for use as text against a dark surface, not
              // as a solid fill behind white button-label text (fails WCAG AA there) —
              // --danger-fill/--accent-fill are the button-fill-safe equivalents.
              style={{ backgroundColor: variant === "danger" ? "var(--danger-fill)" : "var(--accent-fill)" }}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
