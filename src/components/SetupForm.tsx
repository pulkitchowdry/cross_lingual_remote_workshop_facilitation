"use client";

import { useState } from "react";

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
          className="rounded-lg border border-black/10 p-3 text-sm dark:border-white/10 dark:bg-black"
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
      <button
        type="submit"
        className="w-fit rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
      >
        Start session
      </button>
      {submitted && (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">
          Goal set. The facilitator dashboard will track progress against: &ldquo;{goal}&rdquo;
        </p>
      )}
    </form>
  );
}
