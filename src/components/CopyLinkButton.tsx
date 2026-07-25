"use client";

import { useState } from "react";

export function CopyLinkButton({
  value,
  label,
  copiedLabel,
  failedLabel,
}: {
  value: string;
  label: string;
  copiedLabel: string;
  failedLabel: string;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard API unavailable.");
      await navigator.clipboard.writeText(value);
      setStatus("copied");
    } catch {
      // A rejected/throwing writeText (denied clipboard permission, an insecure
      // context, no Clipboard API at all) previously failed silently — the
      // facilitator would click "Copy link", see nothing happen, and have no way
      // to know they needed to fall back to selecting the link input manually.
      setStatus("failed");
    }
    setTimeout(() => setStatus("idle"), 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={`font-data w-fit shrink-0 rounded-md border px-4 py-2 text-xs font-medium uppercase tracking-wider transition-colors ${
        status === "copied"
          ? "border-[var(--tick-high)] text-[var(--tick-high)]"
          : status === "failed"
            ? "border-[var(--tick-low)] text-[var(--tick-low)]"
            : "border-border-strong text-foreground hover:border-accent hover:text-accent"
      }`}
    >
      {status === "copied" ? copiedLabel : status === "failed" ? failedLabel : label}
    </button>
  );
}
