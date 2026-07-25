"use client";

import { useState, type ComponentProps } from "react";
import { SessionChatPanel } from "@/components/SessionChatPanel";
import { LiveTranscriptFeed } from "@/components/LiveTranscriptFeed";

type Tab = "chat" | "captions";

/**
 * Chat and captions share one panel with a tab switcher instead of living in
 * separate parts of the page — captions used to render in their own
 * full-width section further down; this keeps both readable side-by-side
 * with the video without doubling the vertical space they take up.
 */
export function SessionSidePanel({
  chat,
  captions,
  captionsHeader,
  captionComposer,
  chatTabLabel,
  captionsTabLabel,
  defaultTab = "chat",
}: {
  chat: ComponentProps<typeof SessionChatPanel>;
  captions: ComponentProps<typeof LiveTranscriptFeed>;
  captionsHeader?: React.ReactNode;
  captionComposer?: React.ReactNode;
  chatTabLabel: string;
  captionsTabLabel: string;
  defaultTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(defaultTab);

  return (
    <div className="flex h-[38rem] flex-col gap-2">
      <div role="tablist" className="flex gap-1 rounded-lg border border-border-subtle bg-surface p-1">
        {(
          [
            ["chat", chatTabLabel],
            ["captions", captionsTabLabel],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`font-data flex-1 rounded-md px-3 py-1.5 text-xs font-medium uppercase tracking-wider ${
              tab === value ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {tab === "chat" ? (
          <SessionChatPanel {...chat} />
        ) : (
          <LiveTranscriptFeed {...captions} header={captionsHeader} composer={captionComposer} />
        )}
      </div>
    </div>
  );
}
