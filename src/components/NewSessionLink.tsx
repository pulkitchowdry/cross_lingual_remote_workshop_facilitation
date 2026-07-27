"use client";

import { useId, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Like a plain `<Link href="/setup">`, but confirms first. Facilitator auth is a
 * per-session cookie, and starting a new workshop from a still-LIVE facilitator
 * dashboard can leave the current session's learners without an active facilitator.
 * Native `<dialog>` for the same reasons as `ConfirmSubmitButton` (focus trap, Escape,
 * `::backdrop`, all free) — not reused directly since this navigates via the router
 * rather than submitting a form.
 */
export function NewSessionLink({
  label,
  title,
  body,
  confirmLabel,
  cancelLabel,
}: {
  label: string;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const titleId = useId();
  const bodyId = useId();

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="font-data border-b-2 border-transparent pb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
      >
        {label}
      </button>
      <dialog
        ref={dialogRef}
        role="alertdialog"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
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
              onClick={() => {
                dialogRef.current?.close();
                router.push("/setup");
                // <dialog>.close() restores focus to this button, but router.push then
                // unmounts it (AppShell swaps NewSessionLink out once the pathname is
                // /setup — see facilitatorSessionId above) — same failure mode
                // ConfirmSubmitButton.tsx documents and works around.
                document.getElementById("main-content")?.focus();
              }}
              className="font-data rounded-md px-4 py-2 text-xs font-medium uppercase tracking-wider text-accent-foreground"
              style={{ backgroundColor: "var(--accent-fill)" }}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
