"use client";

import { useRef } from "react";
import { SessionChatPanel } from "@/components/SessionChatPanel";
import { useMeetingShell, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH } from "@/components/meeting/MeetingShellContext";
import { ChatIcon, CloseIcon } from "@/components/meeting/icons";
import { useMediaQuery } from "@/lib/use-media-query";
import { getDictionary } from "@/lib/i18n";
import type { MeetingChatMessage } from "@/components/meeting/types";
import type { SupportedLanguage } from "@/lib/session-contracts";

export function MeetingSidebar({
  uiLang,
  targetLanguage,
  messages,
  sendChatAction,
  allowQuestions,
}: {
  uiLang: SupportedLanguage;
  targetLanguage: string;
  messages: MeetingChatMessage[];
  sendChatAction: (formData: FormData) => void | Promise<void>;
  allowQuestions?: boolean;
}) {
  const { sidebarOpen, setSidebarOpen, sidebarWidth, setSidebarWidth } = useMeetingShell();
  const dict = getDictionary(uiLang).meeting;
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);
  const isMobile = useMediaQuery("(max-width: 767px)");

  function onResizePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    dragState.current = { startX: event.clientX, startWidth: sidebarWidth };
    // `currentTarget` (this handle) rather than `target` — and swallow the
    // rare NotFoundError Chromium throws if the pointer was already released
    // by the time this runs (e.g. a very fast drag-release).
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Ignored — worst case the drag just doesn't start for this gesture.
    }
  }
  function onResizePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragState.current) return;
    // Sidebar is docked right — dragging left (negative delta) grows it.
    setSidebarWidth(dragState.current.startWidth - (event.clientX - dragState.current.startX));
  }
  function onResizePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    dragState.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Already released — nothing to do.
    }
  }

  if (!sidebarOpen) {
    // The toolbar has no chat button (7 buttons total, per design) — this is
    // the only way to reopen chat on any screen size, so it must never be
    // fully hidden, just repositioned: a floating corner button on mobile
    // (the docked rail doesn't fit once chat becomes a full-width drawer),
    // a slim rail on desktop/tablet.
    if (isMobile) {
      return (
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          aria-label={dict.expandSidebar}
          className="fixed bottom-20 right-4 z-30 flex h-12 w-12 items-center justify-center rounded-full text-accent-foreground shadow-lg transition-transform active:scale-95"
          style={{ background: "var(--accent)" }}
        >
          <ChatIcon className="h-5 w-5" />
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={() => setSidebarOpen(true)}
        aria-label={dict.expandSidebar}
        className="font-data flex h-24 w-9 shrink-0 flex-col items-center justify-center gap-2 rounded-l-lg border border-r-0 border-border-subtle bg-surface-raised text-muted-foreground shadow-sm transition-colors hover:text-foreground"
      >
        <ChatIcon className="h-4 w-4 shrink-0" />
        <span className="text-[0.625rem] font-medium uppercase tracking-wide" style={{ writingMode: "vertical-rl" }}>
          {dict.chatLabel}
        </span>
      </button>
    );
  }

  const panel = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border-subtle px-2 py-1.5">
        <p className="font-data px-1 text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">{dict.chatLabel}</p>
        <button
          type="button"
          onClick={() => setSidebarOpen(false)}
          aria-label={dict.collapseSidebar}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
        >
          <CloseIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      <SessionChatPanel messages={messages} targetLanguage={targetLanguage} sendAction={sendChatAction} allowQuestions={allowQuestions} embedded />
    </div>
  );

  // Mobile: full-screen drawer over the workspace instead of a docked side panel — dragging to
  // resize doesn't make sense at full width, so the resize handle is desktop/tablet-only.
  if (isMobile) {
    return (
      <>
        <button
          type="button"
          aria-label={dict.collapseSidebar}
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-black/50"
        />
        <div className="fixed inset-x-0 bottom-0 z-40 flex h-[85vh] flex-col overflow-hidden rounded-t-xl border border-border-subtle bg-surface-raised shadow-lg">
          {panel}
        </div>
      </>
    );
  }

  return (
    <div
      className="relative flex h-full shrink-0 flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface-raised transition-[width] duration-150"
      style={{ width: sidebarWidth }}
    >
      <div
        className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize touch-none hover:bg-accent/40"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        role="separator"
        aria-orientation="vertical"
        aria-label={dict.resizeSidebar}
      />
      {panel}
    </div>
  );
}

export { SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH };
