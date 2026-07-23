"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

export function SetupForm() {
  const [goal, setGoal] = useState("");
  const [submitted, setSubmitted] = useState(false);

  return (
    <form
      className="flex max-w-xl flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
      }}
    >
      <label className="flex flex-col gap-2 text-sm font-medium">
        Workshop goal
        <textarea
          className="rounded-lg border border-border-strong bg-surface-raised p-3 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          rows={4}
          required
          value={goal}
          onChange={(event) => {
            setGoal(event.target.value);
            setSubmitted(false);
          }}
          placeholder="e.g. Implement a working REST endpoint for user signup, including input validation."
        />
      </label>
      <Button type="submit">Start session</Button>
      {submitted && (
        <p className="text-sm" style={{ color: "var(--tick-high)" }}>
          Goal set. The facilitator dashboard will track progress against: &ldquo;{goal}&rdquo;
        </p>
      )}
    </form>
  );
}
