"use client";

import { useState } from "react";

export function QuestionBox() {
  const [question, setQuestion] = useState("");
  const [sent, setSent] = useState<string | null>(null);

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        setSent(question);
        setQuestion("");
      }}
    >
      <label className="flex flex-col gap-2 text-sm font-medium">
        Ask the facilitator
        <textarea
          className="rounded-lg border border-black/10 p-3 text-sm dark:border-white/10 dark:bg-black"
          rows={2}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Type your question in your own language; the facilitator will see a translation."
        />
      </label>
      <button
        type="submit"
        disabled={!question}
        className="w-fit rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-40 dark:hover:bg-[#ccc]"
      >
        Send question
      </button>
      {sent && (
        <p role="status" className="text-sm text-zinc-500 dark:text-zinc-400">
          Sent to facilitator: &ldquo;{sent}&rdquo;
        </p>
      )}
    </form>
  );
}
