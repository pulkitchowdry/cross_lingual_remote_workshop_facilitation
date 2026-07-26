"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { FormActionResult } from "@/lib/session-contracts";

export interface CaptionComprehensionAction {
  label: string;
  message: string;
}

type QuestionAction = (prevState: FormActionResult, formData: FormData) => Promise<FormActionResult>;

export function CaptionComprehensionForm({
  action,
  item,
  pendingLabel,
}: {
  action: QuestionAction;
  item: CaptionComprehensionAction;
  pendingLabel: string;
}) {
  const [state, formAction] = useActionState<FormActionResult, FormData>(action, { error: null });

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="kind" value="QUESTION" />
      <input type="hidden" name="message" value={item.message} />
      <CaptionComprehensionButton label={item.label} pendingLabel={pendingLabel} />
      {state.error && (
        <p className="text-[0.6875rem]" role="alert" style={{ color: "var(--tick-low)" }}>
          {state.error}
        </p>
      )}
    </form>
  );
}

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
