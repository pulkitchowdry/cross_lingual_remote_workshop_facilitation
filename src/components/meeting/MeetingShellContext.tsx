"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type ReactNode, type SetStateAction } from "react";
import { useMediaQuery } from "@/lib/use-media-query";

export type WorkspaceMode = "video" | "whiteboard";
export type CaptionMode = "both" | "translated-only";
export type CaptionPosition = "bottom" | "top";

export const SIDEBAR_MIN_WIDTH = 320;
export const SIDEBAR_MAX_WIDTH = 520;
export const SIDEBAR_DEFAULT_WIDTH = 360;

const CAPTION_FONT_SCALE_MIN = 0.85;
const CAPTION_FONT_SCALE_MAX = 1.4;
const CAPTION_FONT_SCALE_STEP = 0.15;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

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

export function MeetingShellProvider({ children }: { children: ReactNode }) {
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("video");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // On mobile, MeetingSidebar renders the open sidebar as an 85vh-tall drawer over the
  // *entire* workspace (see its own `isMobile` branch), not a slim side panel like
  // desktop — defaulting it open there hid the video/toolbar behind that drawer the
  // instant a phone joined the room, with only a sliver of video visible above it.
  // `useMediaQuery`'s SSR snapshot is always `false` (see its own doc comment), so a
  // plain `useState(!isMobile)` would just capture that always-false value; this
  // corrects the default once, the first time the real (client-side) viewport is
  // known to be mobile-width.
  const isMobile = useMediaQuery("(max-width: 767px)");
  const hasAppliedMobileSidebarDefaultRef = useRef(false);
  useEffect(() => {
    if (isMobile && !hasAppliedMobileSidebarDefaultRef.current) {
      hasAppliedMobileSidebarDefaultRef.current = true;
      setSidebarOpen(false);
    }
  }, [isMobile]);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [captionsVisible, setCaptionsVisible] = useState(true);
  const [captionMode, setCaptionMode] = useState<CaptionMode>("both");
  const [captionFontScale, setCaptionFontScale] = useState(1);
  const [captionPosition, setCaptionPosition] = useState<CaptionPosition>("bottom");
  const pipController = useRef<{ enter: () => void } | null>(null);

  const value = useMemo<MeetingShellState>(
    () => ({
      workspaceMode,
      setWorkspaceMode,
      sidebarOpen,
      setSidebarOpen,
      sidebarWidth,
      setSidebarWidth: (width) => setSidebarWidth(clamp(width, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH)),
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
