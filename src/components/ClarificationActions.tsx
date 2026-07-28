"use client";

import { useActionState } from "react";
import type { FormActionResult } from "@/lib/session-contracts";
import { CLARIFICATION_REASONS, type ClarificationReason } from "@/lib/confidence";

type SendAction = (prevState: FormActionResult, formData: FormData) => Promise<FormActionResult>;

const REASON_LABEL_KEY: Record<ClarificationReason, "clarificationReasonCouldNotHear" | "clarificationReasonTranslationIncorrect" | "clarificationReasonPleaseRepeat" | "clarificationReasonExplainDifferently"> = {
  "could-not-hear": "clarificationReasonCouldNotHear",
  "translation-incorrect": "clarificationReasonTranslationIncorrect",
  "please-repeat": "clarificationReasonPleaseRepeat",
  "explain-differently": "clarificationReasonExplainDifferently",
};

/**
 * "Request clarification" for a Medium/Low-confidence caption (issue #130's
 * "Recipient Action") — one QUESTION chat message per reason, same
 * sendChatMessage plumbing CaptionComprehensionActions uses, so the
 * facilitator sees *why* clarification was requested instead of a generic
 * "I'm confused" ping.
 */
export function ClarificationActions({
  sendAction,
  originalText,
  requestClarificationLabel,
  reasonLabels,
  sendingLabel,
}: {
  sendAction: SendAction;
  originalText: string;
  requestClarificationLabel: string;
  reasonLabels: Record<ClarificationReason, string>;
  sendingLabel: string;
}) {
  const [state, action, pending] = useActionState<FormActionResult, FormData>(sendAction, { error: null });

  return (
    <div className="flex flex-col gap-1.5" onClick={(event) => event.stopPropagation()}>
      <p className="font-data text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground">
        {requestClarificationLabel}
      </p>
      <div className="flex flex-wrap gap-2">
        {CLARIFICATION_REASONS.map((reason, index) => (
          <form
            key={reason}
            action={action}
            className="animate-fade-in-up animate-stagger"
            style={{ "--stagger-index": index } as React.CSSProperties}
          >
            <input type="hidden" name="kind" value="QUESTION" />
            <input
              type="hidden"
              name="message"
              value={`${reasonLabels[reason]}: "${originalText.slice(0, 200)}"`}
            />
            <button
              type="submit"
              disabled={pending}
              aria-disabled={pending}
              className="font-data press-scale rounded-md border border-border-strong px-3 py-2 text-[0.6875rem] font-medium uppercase tracking-wider text-foreground transition-colors duration-150 hover:border-accent hover:text-[var(--accent-text)] focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? sendingLabel : reasonLabels[reason]}
            </button>
          </form>
        ))}
      </div>
      {state.error && (
        <p className="animate-fade-in text-xs" role="alert" style={{ color: "var(--tick-low)" }}>
          {state.error}
        </p>
      )}
    </div>
  );
}

export { REASON_LABEL_KEY };
