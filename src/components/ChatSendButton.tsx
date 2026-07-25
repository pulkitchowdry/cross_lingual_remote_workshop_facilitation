"use client";

import { useFormStatus } from "react-dom";

/**
 * `sendChatMessage` awaits translation into every supported language before the
 * message is persisted — up to ~13s worst case (local-inference timeout, then a
 * Claude fallback) with no prior UI feedback. Disabling the button while the
 * form action is pending stops a double-click (or an impatient retry during a
 * slow network) from submitting the same message twice. Must live in its own
 * "use client" component — `useFormStatus` only sees the nearest ancestor
 * `<form>`, so it can't be called from the (server) component that renders it.
 */
export function ChatSendButton({ label, sendingLabel }: { label: string; sendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="font-data w-fit rounded-md bg-accent-fill px-4 py-2 text-xs font-medium uppercase tracking-wider text-accent-foreground disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? sendingLabel : label}
    </button>
  );
}
