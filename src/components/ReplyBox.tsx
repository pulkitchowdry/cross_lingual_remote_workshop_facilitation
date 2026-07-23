"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export function ReplyBox() {
  const [reply, setReply] = useState("");
  const [sent, setSent] = useState<string | null>(null);

  return (
    <Card>
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setSent(reply);
          setReply("");
        }}
      >
        <label className="flex flex-col gap-2 text-sm font-medium">
          Reply to the group
          <textarea
            className="rounded-lg border border-border-subtle bg-background p-3 text-sm text-foreground"
            rows={2}
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            placeholder="Type guidance for the group; it will be translated for them."
          />
        </label>
        <Button type="submit" disabled={!reply}>
          Send translated reply
        </Button>
        {sent && (
          <p className="text-sm text-muted-foreground">Sent: &ldquo;{sent}&rdquo;</p>
        )}
      </form>
    </Card>
  );
}
