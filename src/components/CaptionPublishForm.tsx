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
 * hook, and the facilitator page that renders this is a Server Component. Mirrors the
 * learner's own caption composer (learn/page.tsx) layout/styling so the two match.
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
      <label className="sr-only" htmlFor="facilitator-caption">{dict.captionLabel}</label>
      <textarea
        id="facilitator-caption"
        className="resize-none rounded-md border border-border-strong bg-background p-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
        name="captionText"
        rows={2}
        required
        maxLength={3000}
        placeholder={dict.captionPlaceholder}
      />
      {state.error && (
        <p className="text-xs" role="alert" style={{ color: "var(--tick-low)" }}>
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
