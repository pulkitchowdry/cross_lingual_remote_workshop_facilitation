"use client";

import { useFormStatus } from "react-dom";

export function CaptionComprehensionButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="font-data rounded-md border border-border-strong px-3 py-1.5 text-[0.6875rem] font-medium uppercase tracking-wider text-foreground hover:border-accent hover:text-[var(--accent-text)] focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
