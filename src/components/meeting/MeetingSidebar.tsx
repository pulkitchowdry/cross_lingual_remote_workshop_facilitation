"use client";

import { useRef, useState, type ReactNode } from "react";
import { SessionChatPanel, type PrivateRecipientOption } from "@/components/SessionChatPanel";
import { TranslationHistoryTab } from "@/components/meeting/TranslationHistoryTab";
import { AnalyticsPanelContent } from "@/components/AnalyticsDrawer";
import { useMeetingShell, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH } from "@/components/meeting/MeetingShellContext";
import { ChatIcon, CloseIcon } from "@/components/meeting/icons";
import { useMediaQuery } from "@/lib/use-media-query";
import { getDictionary } from "@/lib/i18n";
import type { MeetingChatMessage, MeetingTranscriptSegment } from "@/components/meeting/types";
import type { FormActionResult, SupportedLanguage } from "@/lib/session-contracts";
import type { FacilitatorAnalyticsView } from "@/lib/facilitator-analytics-view";

type SidebarTab = "chat" | "captions" | "analytics";

export function MeetingSidebar({
  uiLang,
  targetLanguage,
  messages,
  sendChatAction,
  allowQuestions,
  viewerIsFacilitator,
  viewerUserId,
  canMessageFacilitatorPrivately,
  privateRecipientOptions,
  transcript,
  captionsEmptyLabel,
  captionsHeader,
  captionComposer,
  defaultTab = "chat",
  analyticsView,
}: {
  uiLang: SupportedLanguage;
  targetLanguage: string;
  messages: MeetingChatMessage[];
  sendChatAction: (prevState: FormActionResult, formData: FormData) => Promise<FormActionResult>;
  allowQuestions?: boolean;
  viewerIsFacilitator?: boolean;
  viewerUserId?: string;
  canMessageFacilitatorPrivately?: boolean;
  privateRecipientOptions?: PrivateRecipientOption[];
  transcript: MeetingTranscriptSegment[];
  captionsEmptyLabel: string;
  captionsHeader?: ReactNode;
  captionComposer?: ReactNode;
  /** Captions/translation are this product's whole reason to exist for a learner (see
   * problem_statement.md) — defaulting to the Chat tab (empty until someone types
   * something) reads as "nothing is happening" to a first-time learner who hasn't
   * discovered the other tab yet, right when live captions are actually the thing to
   * look at. Facilitators still default to Chat (matching SessionSidePanel's own
   * default), since they're the one composing captions, not just reading them. */
  defaultTab?: SidebarTab;
  /** Facilitator-only "Analytics" tab (see facilitator/room/page.tsx) — omitted
   * entirely (no tab rendered) when absent, e.g. for a learner. */
  analyticsView?: FacilitatorAnalyticsView;
}) {
  const { sidebarOpen, setSidebarOpen, sidebarWidth, setSidebarWidth } = useMeetingShell();
  const dict = getDictionary(uiLang).meeting;
  const commonDict = getDictionary(uiLang).common;
  const analyticsTabLabel = getDictionary(uiLang).facilitator.analyticsDrawerLabel;
  const [tab, setTab] = useState<SidebarTab>(defaultTab);
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
  // Keyboard equivalent of the pointer-drag resize above — same width state
  // (`sidebarWidth`/`setSidebarWidth`, which already clamps to
  // SIDEBAR_MIN_WIDTH/SIDEBAR_MAX_WIDTH in MeetingShellContext), just stepped
  // instead of dragged. Sidebar is docked right, so ArrowLeft (which drags the
  // handle further from the sidebar) grows it, matching onResizePointerMove's
  // own sign convention.
  const RESIZE_STEP = 16;
  function onResizeKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setSidebarWidth(sidebarWidth + RESIZE_STEP);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setSidebarWidth(sidebarWidth - RESIZE_STEP);
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
          // MeetingToolbar's control-bar row wraps to two lines below ~396px viewport
          // width (7 buttons at 44px + gaps don't fit narrower than that) — at
          // `bottom-20` this button's own footprint (80px-128px from the viewport
          // bottom) lands squarely on top of that wrapped second row. `bottom-36`
          // clears the wrapped toolbar's full height (~128px) with room to spare;
          // above that width the toolbar fits on one line and the extra gap here is
          // harmless.
          className="animate-scale-in fixed bottom-20 right-4 z-30 flex h-12 w-12 items-center justify-center rounded-full text-accent-foreground shadow-lg transition-transform active:scale-95 max-[430px]:bottom-36"
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
        className="font-data press-scale animate-slide-in-right flex h-24 w-9 shrink-0 flex-col items-center justify-center gap-2 rounded-l-lg border border-r-0 border-border-subtle bg-surface-raised text-muted-foreground shadow-sm transition-colors hover:text-foreground"
      >
        <ChatIcon className="h-4 w-4 shrink-0" />
        <span className="text-[0.625rem] font-medium uppercase tracking-wide" style={{ writingMode: "vertical-rl" }}>
          {dict.chatLabel}
        </span>
      </button>
    );
  }

  const tabs: Array<[SidebarTab, string]> = [
    ["chat", commonDict.chatTab],
    ["captions", commonDict.captionsTab],
  ];
  // Facilitator-only, and only once analyticsView is actually available (a learner,
  // or a facilitator page that hasn't been wired up yet, simply omits the prop — see
  // LiveSessionRoom's doc comment on it).
  if (viewerIsFacilitator && analyticsView) tabs.push(["analytics", analyticsTabLabel]);

  const tabId = (value: SidebarTab) => `meeting-sidebar-tab-${value}`;
  const panelId = (value: SidebarTab) => `meeting-sidebar-panel-${value}`;

  // ARIA Authoring Practices tabs pattern: Left/Right moves focus between tabs and
  // activates the newly-focused one (roving tabindex — only the active tab is
  // Tab-reachable), Home/End jump to the first/last tab.
  function onTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextValue = tabs[nextIndex][0];
    setTab(nextValue);
    document.getElementById(tabId(nextValue))?.focus();
  }

  const panel = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b border-border-subtle p-1.5">
        <div role="tablist" className="flex flex-1 gap-1 rounded-md bg-surface p-1">
          {tabs.map(([value, label], index) => (
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
              className={`font-data press-scale flex-1 rounded-md px-2 py-1 text-[0.6875rem] font-medium uppercase tracking-wide transition-colors ${
                tab === value ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setSidebarOpen(false)}
          aria-label={dict.collapseSidebar}
          className="press-scale flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>
      <div
        className="min-h-0 flex-1"
        id={panelId(tab)}
        role="tabpanel"
        aria-labelledby={tabId(tab)}
        tabIndex={0}
      >
        {tab === "chat" ? (
          <SessionChatPanel
            messages={messages}
            targetLanguage={targetLanguage}
            sendAction={sendChatAction}
            allowQuestions={allowQuestions}
            viewerIsFacilitator={viewerIsFacilitator}
            viewerUserId={viewerUserId}
            canMessageFacilitatorPrivately={canMessageFacilitatorPrivately}
            privateRecipientOptions={privateRecipientOptions}
            embedded
          />
        ) : tab === "captions" ? (
          <div className="h-full p-1.5">
            <TranslationHistoryTab
              transcript={transcript}
              uiLang={uiLang}
              emptyLabel={captionsEmptyLabel}
              header={captionsHeader}
              composer={captionComposer}
              sendChatAction={sendChatAction}
              viewerIsFacilitator={viewerIsFacilitator}
            />
          </div>
        ) : (
          analyticsView && (
            // No collapsible toggle here (unlike AnalyticsDrawer on the dashboard) —
            // selecting this tab already is the "show analytics" action.
            <div className="h-full overflow-y-auto p-2">
              <AnalyticsPanelContent
                analytics={analyticsView.analytics}
                isFrozen={false}
                labels={analyticsView.labels}
                participationRows={analyticsView.participationRows}
                blockersSummary={analyticsView.blockersSummary}
                languageRows={analyticsView.languageRows}
                confidenceSummary={analyticsView.confidenceSummary}
                activeActionItems={analyticsView.activeActionItems}
                showActiveActionItems
              />
            </div>
          )
        )}
      </div>
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
        {/* `dvh` after `vh` (not instead of): `dvh` tracks the actually-visible viewport
            (shrinks for iOS Safari's chrome/on-screen keyboard) where supported, with the
            plain `vh` value as the fallback for engines that don't support it. */}
        <div className="animate-fade-in-up fixed inset-x-0 bottom-0 z-40 flex h-[85vh] h-[85dvh] flex-col overflow-hidden rounded-t-xl border border-border-subtle bg-surface-raised shadow-lg">
          {panel}
        </div>
      </>
    );
  }

  return (
    <div
      className="animate-slide-in-right relative flex h-full shrink-0 flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface-raised transition-[width] duration-150"
      style={{ width: sidebarWidth }}
    >
      <div
        className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize touch-none hover:bg-accent/40"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onKeyDown={onResizeKeyDown}
        tabIndex={0}
        role="separator"
        aria-orientation="vertical"
        aria-label={dict.resizeSidebar}
        aria-valuenow={sidebarWidth}
        aria-valuemin={SIDEBAR_MIN_WIDTH}
        aria-valuemax={SIDEBAR_MAX_WIDTH}
      />
      {panel}
    </div>
  );
}

export { SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH };
