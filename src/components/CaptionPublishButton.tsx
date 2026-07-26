"use client";

import { useFormStatus } from "react-dom";

/**
 * `publishCaption` awaits translation into every supported language before the
 * caption is persisted — up to ~16s worst case (local-inference tried first, then a
 * Claude fallback retried once on a transient failure), with no prior UI feedback.
 * Unlike `ChatSendButton` (which this mirrors), this plain server-rendered button had
 * no pending/disabled state at all, so a facilitator seeing nothing happen could
 * click Publish again on the same still-populated textarea and get the same caption
 * translated and persisted twice. Must live in its own "use client" component —
 * `useFormStatus` only sees the nearest ancestor `<form>`, so it can't be called from
 * the (server) component that renders it.
 */
export function CaptionPublishButton({ label, publishingLabel }: { label: string; publishingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="font-data shrink-0 rounded-md border border-border-strong px-4 py-2 text-xs font-medium uppercase tracking-wider text-foreground disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? publishingLabel : label}
    </button>
  );
}
