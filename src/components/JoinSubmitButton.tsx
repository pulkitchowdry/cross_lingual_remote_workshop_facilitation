"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";

/**
 * `joinSession` has no idempotency guard — a double-click or a slow-network retry
 * before the first request's redirect completes creates two separate User +
 * SessionParticipant rows for what's really one person (each with fresh cuids, so
 * the [sessionId,userId] unique constraint never catches it), inflating the
 * facilitator's "learners joined" count. Disabling the button while the action is
 * pending stops the double-submit at its source, mirroring `ChatSendButton`. Must
 * live in its own "use client" component — `useFormStatus` only sees the nearest
 * ancestor `<form>`, so it can't be called from the (server) component that renders it.
 */
export function JoinSubmitButton({ label, submittingLabel }: { label: string; submittingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-disabled={pending}>
      {pending ? submittingLabel : label}
    </Button>
  );
}
