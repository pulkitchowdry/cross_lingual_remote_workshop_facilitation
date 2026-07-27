"use client";

import { useFormStatus } from "react-dom";

/**
 * Plain pending-disable submit button for "Start Session" — unlike "End session"/
 * "Revoke invite" (ConfirmSubmitButton), starting a session isn't a destructive,
 * hard-to-undo action, so it doesn't need a confirmation dialog, just the same
 * disable-while-pending protection every other action button on this page already has
 * (mirrors ChatSendButton/JoinSubmitButton). Without this, a rapid double-click could
 * submit `startSession` twice — the second invocation now hits its DRAFT-only guard
 * (see startSession's own doc comment in facilitator/actions.ts). Must live in its own
 * "use client" component — `useFormStatus` only sees the nearest ancestor `<form>`, so
 * it can't be called from the (server) component that renders it.
 */
export function StartSessionButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="font-data rounded-md bg-accent-fill px-5 py-2 text-xs font-medium uppercase tracking-wider text-accent-foreground disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
