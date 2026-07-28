"use client";

import { useActionState } from "react";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import type { FormActionResult } from "@/lib/session-contracts";

export function EndSessionForm({
  action,
  labels,
}: {
  action: (prevState: FormActionResult, formData: FormData) => Promise<FormActionResult>;
  labels: {
    endSession: string;
    endingSession: string;
    title: string;
    body: string;
    confirm: string;
    cancel: string;
  };
}) {
  const [state, formAction] = useActionState<FormActionResult, FormData>(action, { error: null });

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <ConfirmSubmitButton
        label={labels.endSession}
        pendingLabel={labels.endingSession}
        title={labels.title}
        body={labels.body}
        confirmLabel={labels.confirm}
        cancelLabel={labels.cancel}
        variant="danger"
      />
      {state.error && (
        <p className="max-w-sm break-words text-xs" role="alert" style={{ color: "var(--tick-low)" }}>
          {state.error}
        </p>
      )}
    </form>
  );
}
