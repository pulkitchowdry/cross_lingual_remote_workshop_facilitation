"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { LearnerParticipation } from "@/lib/types";

export function QuietParticipantNudge({ learner }: { learner: LearnerParticipation }) {
  const [dismissed, setDismissed] = useState(false);

  if (learner.status !== "quiet" || learner.reminderSent || dismissed) {
    return null;
  }

  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-lg border border-accent/40 bg-accent/10 p-4"
    >
      <p className="text-sm">
        We haven&apos;t heard from you in a while — everything okay? Feel free to ask a question
        or jump into the next poll whenever you&apos;re ready.
      </p>
      <Button
        variant="secondary"
        className="self-start"
        onClick={() => setDismissed(true)}
      >
        I&apos;m following along
      </Button>
    </div>
  );
}
