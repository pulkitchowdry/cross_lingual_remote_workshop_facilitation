"use client";

import { useState } from "react";

export function ReplyBox() {
  const [reply, setReply] = useState("");
  const [sent, setSent] = useState<string | null>(null);

  return (
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
          className="rounded-lg border border-black/10 p-3 text-sm dark:border-white/10 dark:bg-black"
          rows={2}
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          placeholder="Type guidance for the group; it will be translated for them."
        />
      </label>
      <button
        type="submit"
        disabled={!reply}
        className="w-fit rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-40 dark:hover:bg-[#ccc]"
      >
        Send translated reply
      </button>
      {sent && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Sent: &ldquo;{sent}&rdquo;</p>
      )}
    </form>
  );
}
