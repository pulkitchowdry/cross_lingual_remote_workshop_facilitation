"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

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
          className="rounded-lg border border-border-strong bg-surface-raised p-3 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          rows={2}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Type your question in your own language; the facilitator will see a translation."
        />
      </label>
      <Button type="submit" disabled={!question}>
        Send question
      </Button>
      {sent && (
        <p role="status" className="text-sm text-muted-foreground">
          Sent to facilitator: &ldquo;{sent}&rdquo;
        </p>
      )}
    </form>
  );
}
