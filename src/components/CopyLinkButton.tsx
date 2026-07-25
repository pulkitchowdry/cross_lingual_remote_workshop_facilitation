"use client";

import { useState } from "react";

export function CopyLinkButton({ value, label, copiedLabel }: { value: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={`font-data w-fit shrink-0 rounded-md border px-4 py-2 text-xs font-medium uppercase tracking-wider transition-colors ${
        copied
          ? "border-[var(--tick-high)] text-[var(--tick-high)]"
          : "border-border-strong text-foreground hover:border-accent hover:text-accent"
      }`}
    >
      {copied ? copiedLabel : label}
    </button>
  );
}
