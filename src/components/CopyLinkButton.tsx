"use client";

import { useEffect, useRef, useState } from "react";

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
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimeoutRef.current) clearTimeout(resetTimeoutRef.current);
    };
  }, []);

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
    // Clear any timeout from a previous click so overlapping clicks can't race
    // and reset the visible feedback up to ~2s early.
    if (resetTimeoutRef.current) clearTimeout(resetTimeoutRef.current);
    resetTimeoutRef.current = setTimeout(() => setStatus("idle"), 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      // The visible label is the only feedback for success/failure — without this,
      // a screen-reader user who activates the button hears nothing change and has
      // no way to know whether the copy succeeded, so they'd need to guess or retry
      // blindly. aria-live (not role="status") to avoid overriding the native button
      // role that's still needed for the element to be announced as interactive.
      aria-live="polite"
      className={`font-data w-fit shrink-0 rounded-md border px-4 py-2 text-xs font-medium uppercase tracking-wider press-scale transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        status === "copied"
          ? "border-[var(--tick-high)] text-[var(--tick-high)]"
          : status === "failed"
            ? "border-[var(--tick-low)] text-[var(--tick-low)]"
            : "border-border-strong text-foreground hover:border-accent hover:text-accent"
      }`}
    >
      <span key={status} className="inline-block animate-fade-in">
        {status === "copied" ? copiedLabel : status === "failed" ? failedLabel : label}
      </span>
    </button>
  );
}
