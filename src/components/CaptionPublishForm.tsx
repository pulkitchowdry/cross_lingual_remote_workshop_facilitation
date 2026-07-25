"use client";

import { useActionState } from "react";
import { CaptionPublishButton } from "@/components/CaptionPublishButton";
import type { FormActionResult } from "@/lib/session-contracts";

/**
 * Wraps the typed-caption form in `useActionState` so `publishCaption`'s expected,
 * routine failures (caption too long, session not live) show up as an inline message
 * here instead of throwing — a thrown Error with no boundary in the tree crashed the
 * whole facilitator page, video call included, for what's often just a mistimed
 * click right as a session ends. Must be a client component — `useActionState` is a
 * hook, and the facilitator page that renders this is a Server Component.
 */
export function CaptionPublishForm({
  action,
  dict,
}: {
  action: (prevState: FormActionResult, formData: FormData) => Promise<FormActionResult>;
  dict: { captionLabel: string; captionPlaceholder: string; publish: string; publishing: string };
}) {
  const [state, formAction] = useActionState<FormActionResult, FormData>(action, { error: null });

  return (
    <form action={formAction} className="flex flex-col gap-2 border-t border-border-subtle p-4">
      <div className="flex gap-2">
        <label className="sr-only" htmlFor="facilitator-caption">{dict.captionLabel}</label>
        <textarea
          id="facilitator-caption"
          className="flex-1 resize-none rounded-md border border-border-strong bg-background p-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          name="captionText"
          rows={1}
          required
          maxLength={3000}
          placeholder={dict.captionPlaceholder}
        />
        <CaptionPublishButton label={dict.publish} publishingLabel={dict.publishing} />
      </div>
      {state.error && (
        <p className="text-xs" role="alert" style={{ color: "var(--tick-low)" }}>
          {state.error}
        </p>
      )}
    </form>
  );
}
