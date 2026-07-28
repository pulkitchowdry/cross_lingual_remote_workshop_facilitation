"use client";

import { useActionState } from "react";
import { ChatSendButton } from "@/components/ChatSendButton";
import type { FormActionResult } from "@/lib/session-contracts";

/**
 * Wraps the typed-caption form in `useActionState` so `publishCaption`'s expected,
 * routine failures (caption too long, session not live) show up as an inline message
 * here instead of throwing — a thrown Error with no boundary in the tree crashed the
 * whole facilitator page, video call included, for what's often just a mistimed
 * click right as a session ends. Must be a client component — `useActionState` is a
 * hook, and both the facilitator and learner pages that render this are Server
 * Components. Shared by both roles' caption composers (not just the facilitator's,
 * despite the component name) so publishLearnerCaption's own `(prevState, formData)`
 * signature — needed for the same inline-error-instead-of-crash reason as
 * publishCaption — actually gets called with the right arguments: a Server Action
 * bound only to a plain `<form action={...}>` (no `useActionState`) receives just
 * `formData` as its sole argument, silently shifting every parameter over by one.
 */
export function CaptionPublishForm({
  action,
  dict,
}: {
  action: (prevState: FormActionResult, formData: FormData) => Promise<FormActionResult>;
  dict: { captionLabel: string; captionPlaceholder: string; captionAudioHint: string; publish: string; publishing: string };
}) {
  const [state, formAction] = useActionState<FormActionResult, FormData>(action, { error: null });

  return (
    <form action={formAction} className="flex flex-col gap-2 border-t border-border-subtle p-4">
      <label className="sr-only" htmlFor="caption-composer">{dict.captionLabel}</label>
      <textarea
        id="caption-composer"
        className="resize-none rounded-md border border-border-strong bg-background p-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
        name="captionText"
        rows={2}
        required
        maxLength={3000}
        placeholder={dict.captionPlaceholder}
      />
      {state.error && (
        <p className="animate-fade-in text-xs" role="alert" style={{ color: "var(--tick-low)" }}>
          {state.error}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{dict.captionAudioHint}</p>
        <ChatSendButton label={dict.publish} sendingLabel={dict.publishing} />
      </div>
    </form>
  );
}
