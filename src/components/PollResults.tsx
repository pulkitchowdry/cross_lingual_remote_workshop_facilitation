"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { Poll } from "@/lib/types";

export function PollResults({ poll: initialPoll }: { poll: Poll }) {
  const [poll, setPoll] = useState(initialPoll);
  const totalVotes = poll.options.reduce((sum, option) => sum + option.votes, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">{poll.question}</p>
        <span
          className={`font-data w-fit rounded-full px-2.5 py-0.5 text-[0.6875rem] font-medium uppercase tracking-wider ${
            poll.status === "active"
              ? "bg-accent/15 text-accent"
              : "bg-border-subtle text-muted-foreground"
          }`}
        >
          {poll.status}
        </span>
      </div>
      <div className="flex flex-col gap-3">
        {poll.options.map((option) => {
          const pct = totalVotes === 0 ? 0 : Math.round((option.votes / totalVotes) * 100);
          return (
            <div key={option.id} className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-sm">
                <span>{option.text}</span>
                <span className="font-data text-xs text-muted-foreground">
                  {option.votes} · {pct}%
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-border-subtle">
                <div
                  className="h-full rounded-full bg-accent transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <p className="font-data text-xs text-muted-foreground">{totalVotes} responses</p>
      <Button
        variant="secondary"
        className="self-start"
        onClick={() =>
          setPoll((current) => ({
            ...current,
            status: current.status === "active" ? "closed" : "active",
          }))
        }
      >
        {poll.status === "active" ? "Close poll" : "Relaunch poll"}
      </Button>
    </div>
  );
}
