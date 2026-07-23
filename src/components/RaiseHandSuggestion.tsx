"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { LearnerParticipation } from "@/lib/types";

const SUGGESTED_QUESTION = "Could you go over that last point again?";

export function RaiseHandSuggestion({ learner }: { learner: LearnerParticipation }) {
  const [dismissed, setDismissed] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  if (learner.status !== "confused" || dismissed) {
    return null;
  }

  if (submitted) {
    return (
      <div role="status" className="rounded-lg border border-accent/40 bg-accent/10 p-4 text-sm">
        Sent to facilitator: &ldquo;{SUGGESTED_QUESTION}&rdquo;
      </div>
    );
  }

  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-lg border border-[var(--tick-low)]/40 bg-[var(--tick-low)]/10 p-4"
    >
      <p className="text-sm font-medium">We noticed repeated confusion on this topic.</p>
      <p className="text-sm text-muted-foreground">
        Would you like to ask the facilitator? One click sends a translated question for you.
      </p>
      <div className="flex gap-2">
        <Button className="self-start" onClick={() => setSubmitted(true)}>
          Ask the facilitator
        </Button>
        <Button variant="secondary" className="self-start" onClick={() => setDismissed(true)}>
          No thanks
        </Button>
      </div>
    </div>
  );
}
