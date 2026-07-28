"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type ReactNode, type SetStateAction } from "react";
import { useMediaQuery } from "@/lib/use-media-query";

export type WorkspaceMode = "video" | "whiteboard";
export type CaptionMode = "both" | "translated-only";
export type CaptionPosition = "bottom" | "top";

export const SIDEBAR_MIN_WIDTH = 320;
export const SIDEBAR_MAX_WIDTH = 520;
export const SIDEBAR_DEFAULT_WIDTH = 360;

// Mirrors ParticipantGrid's own `minmax(200px, 1fr)` column floor, plus MeetingRoom's
// flex gap/padding and the video/sidebar pane borders around it (~48px) — used below to
// keep a drag toward SIDEBAR_MAX_WIDTH from squeezing the video stage narrower than its
// own hard minimum on a viewport just above the mobile breakpoint (~768-780px wide).
const VIDEO_STAGE_MIN_WIDTH = 200;
const NON_SIDEBAR_LAYOUT_OVERHEAD = 48;

const CAPTION_FONT_SCALE_MIN = 0.85;
const CAPTION_FONT_SCALE_MAX = 1.4;
const CAPTION_FONT_SCALE_STEP = 0.15;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

interface PersistedShellSnapshot {
  workspaceMode: WorkspaceMode;
  sidebarOpen: boolean;
  sidebarWidth: number;
  captionsVisible: boolean;
  captionMode: CaptionMode;
  captionFontScale: number;
  captionPosition: CaptionPosition;
}

const DEFAULT_SHELL_SNAPSHOT: PersistedShellSnapshot = {
  workspaceMode: "video",
  sidebarOpen: true,
  sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
  captionsVisible: true,
  captionMode: "both",
  captionFontScale: 1,
  captionPosition: "bottom",
};

// Module-level, not React state: `<LiveKitRoom key={credentials.token}>` (LiveSessionRoom.tsx)
// fully remounts this provider on every forced token-refresh reconnect, which would
// otherwise silently reset workspace mode, sidebar layout, and caption preferences back
// to these defaults mid-session (e.g. flipping a facilitator's screen off a whiteboard
// they're actively presenting, or losing a low-vision learner's caption font-size bump).
// That remount stays within the same page load, so a module-scoped snapshot survives it.
// Keyed by sessionId so joining a *different* session later in the same tab still starts
// from fresh defaults instead of inheriting the previous session's UI state.
let persistedShellState: { sessionId: string; snapshot: PersistedShellSnapshot } | null = null;

interface MeetingShellState {
  workspaceMode: WorkspaceMode;
  setWorkspaceMode: (mode: WorkspaceMode) => void;

  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;

  captionsVisible: boolean;
  setCaptionsVisible: Dispatch<SetStateAction<boolean>>;
  captionMode: CaptionMode;
  setCaptionMode: (mode: CaptionMode) => void;
  captionFontScale: number;
  growCaptionFont: () => void;
  shrinkCaptionFont: () => void;
  captionPosition: CaptionPosition;
  setCaptionPosition: (position: CaptionPosition) => void;

  /**
   * Set by AutoPictureInPicture (which owns the actual floating <video>
   * element) so the Settings popover's "Picture-in-picture" button can
   * trigger it without threading the video/track plumbing through the
   * toolbar. A ref rather than state — invoking it never needs a re-render.
   */
  pipController: MutableRefObject<{ enter: () => void } | null>;
}

const MeetingShellContext = createContext<MeetingShellState | null>(null);

export function MeetingShellProvider({ sessionId, children }: { sessionId: string; children: ReactNode }) {
  const initialSnapshot =
    persistedShellState?.sessionId === sessionId ? persistedShellState.snapshot : DEFAULT_SHELL_SNAPSHOT;
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(initialSnapshot.workspaceMode);
  const [sidebarOpen, setSidebarOpen] = useState(initialSnapshot.sidebarOpen);
  // On mobile, MeetingSidebar renders the open sidebar as an 85vh-tall drawer over the
  // *entire* workspace (see its own `isMobile` branch), not a slim side panel like
  // desktop — defaulting it open there hid the video/toolbar behind that drawer the
  // instant a phone joined the room, with only a sliver of video visible above it.
  // `useMediaQuery`'s SSR snapshot is always `false` (see its own doc comment), so a
  // plain `useState(!isMobile)` would just capture that always-false value; this
  // corrects the default once, the first time the real (client-side) viewport is
  // known to be mobile-width.
  const isMobile = useMediaQuery("(max-width: 767px)");
  // A remount that restored a prior snapshot for this same session already reflects a
  // real (post-SSR) mobile/desktop decision — only the true first mount needs this
  // one-time SSR-mismatch correction.
  const hasAppliedMobileSidebarDefaultRef = useRef(persistedShellState?.sessionId === sessionId);
  useEffect(() => {
    if (isMobile && !hasAppliedMobileSidebarDefaultRef.current) {
      hasAppliedMobileSidebarDefaultRef.current = true;
      setSidebarOpen(false);
    }
  }, [isMobile]);
  const [sidebarWidth, setSidebarWidth] = useState(initialSnapshot.sidebarWidth);
  const [captionsVisible, setCaptionsVisible] = useState(initialSnapshot.captionsVisible);
  const [captionMode, setCaptionMode] = useState<CaptionMode>(initialSnapshot.captionMode);
  const [captionFontScale, setCaptionFontScale] = useState(initialSnapshot.captionFontScale);
  const [captionPosition, setCaptionPosition] = useState<CaptionPosition>(initialSnapshot.captionPosition);
  const pipController = useRef<{ enter: () => void } | null>(null);

  useEffect(() => {
    persistedShellState = {
      sessionId,
      snapshot: { workspaceMode, sidebarOpen, sidebarWidth, captionsVisible, captionMode, captionFontScale, captionPosition },
    };
  }, [sessionId, workspaceMode, sidebarOpen, sidebarWidth, captionsVisible, captionMode, captionFontScale, captionPosition]);

  const value = useMemo<MeetingShellState>(
    () => ({
      workspaceMode,
      setWorkspaceMode,
      sidebarOpen,
      setSidebarOpen,
      sidebarWidth,
      setSidebarWidth: (width) => {
        const viewportCap =
          typeof window === "undefined"
            ? SIDEBAR_MAX_WIDTH
            : window.innerWidth - VIDEO_STAGE_MIN_WIDTH - NON_SIDEBAR_LAYOUT_OVERHEAD;
        setSidebarWidth(clamp(width, SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, viewportCap)));
      },
      captionsVisible,
      setCaptionsVisible,
      captionMode,
      setCaptionMode,
      captionFontScale,
      growCaptionFont: () => setCaptionFontScale((prev) => clamp(prev + CAPTION_FONT_SCALE_STEP, CAPTION_FONT_SCALE_MIN, CAPTION_FONT_SCALE_MAX)),
      shrinkCaptionFont: () => setCaptionFontScale((prev) => clamp(prev - CAPTION_FONT_SCALE_STEP, CAPTION_FONT_SCALE_MIN, CAPTION_FONT_SCALE_MAX)),
      captionPosition,
      setCaptionPosition,
      pipController,
    }),
    [workspaceMode, sidebarOpen, sidebarWidth, captionsVisible, captionMode, captionFontScale, captionPosition],
  );

  return <MeetingShellContext.Provider value={value}>{children}</MeetingShellContext.Provider>;
}

export function useMeetingShell(): MeetingShellState {
  const ctx = useContext(MeetingShellContext);
  if (!ctx) throw new Error("useMeetingShell must be used within a MeetingShellProvider.");
  return ctx;
}
