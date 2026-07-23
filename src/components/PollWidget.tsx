"use client";

import { useState } from "react";
import type { Poll } from "@/lib/types";

export function PollWidget({ poll }: { poll: Poll }) {
  const [votedOptionId, setVotedOptionId] = useState<string | null>(null);

  if (poll.status !== "active" && !votedOptionId) {
    return (
      <div className="rounded-lg border border-border-subtle bg-surface-raised p-4 text-sm text-muted-foreground">
        No poll is running right now.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-raised p-4">
      <p className="font-medium">{poll.question}</p>
      <div className="flex flex-col gap-2">
        {poll.options.map((option) => {
          const isSelected = votedOptionId === option.id;
          return (
            <button
              key={option.id}
              type="button"
              disabled={!!votedOptionId}
              onClick={() => setVotedOptionId(option.id)}
              className={`rounded-md border px-3 py-2 text-left text-sm transition-colors disabled:cursor-default ${
                isSelected
                  ? "border-accent bg-accent/15 text-accent"
                  : "border-border-strong bg-background text-foreground hover:bg-surface disabled:opacity-60"
              }`}
            >
              {option.text}
            </button>
          );
        })}
      </div>
      {votedOptionId && (
        <p role="status" className="text-sm text-muted-foreground">
          Thanks — your response was sent to the facilitator.
        </p>
      )}
    </div>
  );
}
