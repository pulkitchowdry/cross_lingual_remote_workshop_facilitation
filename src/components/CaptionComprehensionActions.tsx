"use client";

import { useActionState } from "react";
import type { FormActionResult } from "@/lib/session-contracts";

type SendAction = (prevState: FormActionResult, formData: FormData) => Promise<FormActionResult>;

/**
 * Quick "ask about this caption or message" actions for a learner, reusing the same
 * QUESTION-flagged `sendChatMessage` the manual chat composer uses (see
 * SessionChatPanel, which also renders this directly for a chat message, alongside
 * TranslationHistoryTab/learn/page.tsx for a caption) — this only needs to prefill
 * and submit `message`/`kind` on its behalf. Each button owns its own
 * `useActionState` (rather than one submit handler) so a facilitator still gets the
 * two "Explain simply"/"Give an example" questions as distinct QUESTION messages,
 * not one combined submission, and one button's pending/error state doesn't block
 * the other.
 */
export function CaptionComprehensionActions({
  sendAction,
  explainSimplyMessage,
  giveExampleMessage,
  explainSimplyLabel,
  giveExampleLabel,
  sendingLabel,
}: {
  sendAction: SendAction;
  explainSimplyMessage: string;
  giveExampleMessage: string;
  explainSimplyLabel: string;
  giveExampleLabel: string;
  sendingLabel: string;
}) {
  const [explainState, explainAction, explainPending] = useActionState<FormActionResult, FormData>(sendAction, {
    error: null,
  });
  const [exampleState, exampleAction, examplePending] = useActionState<FormActionResult, FormData>(sendAction, {
    error: null,
  });

  return (
    // Rows this renders inside are themselves inside the feed's row-toggle `<button>`'s
    // sibling slot (see LiveTranscriptFeed) — stopPropagation isn't needed here since
    // these buttons no longer live inside that button, but the click still shouldn't
    // bubble to the scroll container's own handlers.
    <div className="flex flex-wrap gap-2" onClick={(event) => event.stopPropagation()}>
      <form action={explainAction}>
        <input type="hidden" name="kind" value="QUESTION" />
        <input type="hidden" name="message" value={explainSimplyMessage} />
        <button
          type="submit"
          disabled={explainPending}
          aria-disabled={explainPending}
          className="font-data press-scale rounded-md border border-border-strong px-3 py-2 text-[0.6875rem] font-medium uppercase tracking-wider text-foreground transition-colors duration-150 hover:border-accent hover:text-[var(--accent-text)] focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {explainPending ? sendingLabel : explainSimplyLabel}
        </button>
      </form>
      <form action={exampleAction}>
        <input type="hidden" name="kind" value="QUESTION" />
        <input type="hidden" name="message" value={giveExampleMessage} />
        <button
          type="submit"
          disabled={examplePending}
          aria-disabled={examplePending}
          className="font-data press-scale rounded-md border border-border-strong px-3 py-2 text-[0.6875rem] font-medium uppercase tracking-wider text-foreground transition-colors duration-150 hover:border-accent hover:text-[var(--accent-text)] focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {examplePending ? sendingLabel : giveExampleLabel}
        </button>
      </form>
      {explainState.error && (
        <p className="animate-fade-in w-full break-words text-xs" role="alert" style={{ color: "var(--tick-low)" }}>
          {explainState.error}
        </p>
      )}
      {exampleState.error && (
        <p className="animate-fade-in w-full break-words text-xs" role="alert" style={{ color: "var(--tick-low)" }}>
          {exampleState.error}
        </p>
      )}
    </div>
  );
}
