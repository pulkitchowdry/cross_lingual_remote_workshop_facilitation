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
  const tabsList = [
    ["chat", chatTabLabel],
    ["captions", captionsTabLabel],
  ] as const;
  const tabId = (value: Tab) => `session-panel-tab-${value}`;
  const panelId = (value: Tab) => `session-panel-tabpanel-${value}`;

  // ARIA Authoring Practices tabs pattern: Left/Right moves focus between tabs and
  // activates the newly-focused one (roving tabindex — only the active tab is
  // Tab-reachable), Home/End jump to the first/last tab.
  function onTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabsList.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabsList.length) % tabsList.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabsList.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextValue = tabsList[nextIndex][0];
    setTab(nextValue);
    document.getElementById(tabId(nextValue))?.focus();
  }

  return (
    // Matches LiveSessionRoom's own clamp so the two line up side by side — a fixed
    // height (not just a flat rem value) is what actually bounds the chat/captions
    // tab content below so it scrolls internally as messages pile up, instead of the
    // whole panel (and the page under it) growing taller without limit.
    <div className="flex h-[clamp(26rem,75vh,54rem)] flex-col gap-2">
      <div role="tablist" className="flex gap-1 rounded-lg border border-border-subtle bg-surface p-1">
        {tabsList.map(([value, label], index) => (
          <button
            key={value}
            id={tabId(value)}
            type="button"
            role="tab"
            aria-selected={tab === value}
            aria-controls={panelId(value)}
            tabIndex={tab === value ? 0 : -1}
            onClick={() => setTab(value)}
            onKeyDown={(event) => onTabKeyDown(event, index)}
            className={`font-data press-scale flex-1 rounded-md px-3 py-1.5 text-xs font-medium uppercase tracking-wider transition-colors duration-150 ${
              tab === value ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        key={tab}
        className="animate-fade-in min-h-0 flex-1"
        id={panelId(tab)}
        role="tabpanel"
        aria-labelledby={tabId(tab)}
        tabIndex={0}
      >
        {tab === "chat" ? (
          <SessionChatPanel {...chat} />
        ) : (
          <LiveTranscriptFeed {...captions} header={captionsHeader} composer={captionComposer} />
        )}
      </div>
    </div>
  );
}
