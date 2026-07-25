"use client";

import * as Tooltip from "@radix-ui/react-tooltip";
import * as Popover from "@radix-ui/react-popover";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDisconnectButton, useLocalParticipant, useParticipantAttributes, useTrackToggle } from "@livekit/components-react";
import { Track } from "livekit-client";
import { setPresenterAccess } from "@/app/sessions/[sessionId]/facilitator/actions";
import { useMeetingShell, type CaptionMode, type CaptionPosition } from "@/components/meeting/MeetingShellContext";
import {
  CameraIcon,
  CameraOffIcon,
  HandIcon,
  LeaveIcon,
  MicIcon,
  MicOffIcon,
  ScreenShareIcon,
  SettingsIcon,
  WhiteboardIcon,
} from "@/components/meeting/icons";
import { getDictionary } from "@/lib/i18n";
import type { SupportedLanguage } from "@/lib/session-contracts";

type Role = "facilitator" | "learner";

function ToolbarButton({
  label,
  active,
  disabled,
  onClick,
  children,
  shortcut,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  shortcut?: string;
}) {
  return (
    <Tooltip.Root delayDuration={300}>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          aria-pressed={active}
          className="flex h-9 w-9 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 sm:h-10 sm:w-10"
          style={{
            background: active ? "var(--accent)" : "var(--surface-raised)",
            color: active ? "var(--accent-foreground)" : "var(--foreground)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          {children}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="top"
          sideOffset={6}
          className="font-data z-20 max-w-[14rem] rounded-md border border-border-strong bg-surface-raised px-2 py-1 text-center text-[0.6875rem] uppercase tracking-wider text-foreground shadow-sm"
        >
          {label}
          {shortcut && <span className="ml-1.5 text-muted-foreground">({shortcut})</span>}
          <Tooltip.Arrow style={{ fill: "var(--surface-raised)" }} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function MeetingToolbar({
  sessionId,
  role,
  uiLang,
  canPresent,
  allowLearnerPresenting,
  containerRef,
  dashboardHref,
}: {
  sessionId: string;
  role: Role;
  uiLang: SupportedLanguage;
  canPresent: boolean;
  allowLearnerPresenting: boolean;
  containerRef: React.RefObject<HTMLElement | null>;
  dashboardHref: string;
}) {
  const dict = getDictionary(uiLang).meeting;
  const router = useRouter();
  const mic = useTrackToggle({ source: Track.Source.Microphone });
  const camera = useTrackToggle({ source: Track.Source.Camera });
  const screenShare = useTrackToggle({ source: Track.Source.ScreenShare });
  const { localParticipant } = useLocalParticipant();
  const { buttonProps: leaveButtonProps } = useDisconnectButton({});
  const { workspaceMode, setWorkspaceMode, captionsVisible, setCaptionsVisible, captionMode, setCaptionMode, captionPosition, setCaptionPosition, pipController } =
    useMeetingShell();
  const pipSupported = typeof window !== "undefined" && Boolean(window.documentPictureInPicture);

  function handleLeave() {
    leaveButtonProps.onClick();
    router.push(dashboardHref);
  }

  const { attributes: localAttributes } = useParticipantAttributes({ participant: localParticipant });
  const raisedHand = localAttributes?.raisedHand === "true";
  const [raiseHandError, setRaiseHandError] = useState(false);

  function toggleRaiseHand() {
    setRaiseHandError(false);
    localParticipant.setAttributes({ raisedHand: String(!raisedHand) }).catch((error) => {
      // Attribute updates round-trip through the LiveKit server (see
      // livekit-client's requestMetadataUpdate) — a disconnected/unstable
      // room connection surfaces here as a timeout, not a bug in this
      // button's click handling. Surface it instead of letting it become an
      // unhandled rejection.
      console.error("[meeting] failed to update raised-hand state:", error);
      setRaiseHandError(true);
    });
  }

  async function togglePresenterAccess(next: boolean) {
    try {
      await setPresenterAccess(sessionId, next);
    } catch (error) {
      console.error("[meeting] failed to update presenter access:", error);
    }
  }

  const latest = useRef({ mic, camera, toggleRaiseHand, setCaptionsVisible });
  useEffect(() => {
    latest.current = { mic, camera, toggleRaiseHand, setCaptionsVisible };
  });

  // Scoped to the room container, not `window`, so it doesn't hijack shortcuts elsewhere on the page.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      const { mic, camera, toggleRaiseHand, setCaptionsVisible } = latest.current;
      if (event.key === "m") void mic.toggle();
      else if (event.key === "v") void camera.toggle();
      else if (event.key === "c") setCaptionsVisible((prev) => !prev);
      else if (event.key === "h") toggleRaiseHand();
    }
    node.addEventListener("keydown", onKeyDown);
    return () => node.removeEventListener("keydown", onKeyDown);
  }, [containerRef]);

  return (
    <Tooltip.Provider>
      <div
        className="flex flex-wrap items-center justify-center gap-2 rounded-full border border-border-subtle bg-surface/90 px-3 py-2 shadow-sm backdrop-blur"
        role="toolbar"
        aria-label={dict.toolbarLabel}
      >
        <ToolbarButton label={mic.enabled ? dict.muteMic : dict.unmuteMic} active={mic.enabled} onClick={() => void mic.toggle()} shortcut="M">
          {mic.enabled ? <MicIcon /> : <MicOffIcon />}
        </ToolbarButton>
        <ToolbarButton label={camera.enabled ? dict.stopCamera : dict.startCamera} active={camera.enabled} onClick={() => void camera.toggle()} shortcut="V">
          {camera.enabled ? <CameraIcon /> : <CameraOffIcon />}
        </ToolbarButton>
        <ToolbarButton
          label={raisedHand ? dict.lowerHand : raiseHandError ? dict.raiseHandFailed : dict.raiseHand}
          active={raisedHand}
          onClick={toggleRaiseHand}
          shortcut="H"
        >
          <HandIcon />
        </ToolbarButton>
        <ToolbarButton
          label={!canPresent ? dict.presentingLocked : screenShare.enabled ? dict.stopShareScreen : dict.shareScreen}
          active={screenShare.enabled}
          disabled={!canPresent}
          onClick={() => void screenShare.toggle()}
        >
          <ScreenShareIcon />
        </ToolbarButton>
        <ToolbarButton
          label={workspaceMode === "whiteboard" ? dict.switchToVideo : dict.switchToWhiteboard}
          active={workspaceMode === "whiteboard"}
          onClick={() => setWorkspaceMode(workspaceMode === "whiteboard" ? "video" : "whiteboard")}
        >
          <WhiteboardIcon />
        </ToolbarButton>

        <Popover.Root>
          <Popover.Trigger asChild>
            <button
              type="button"
              aria-label={dict.settings}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-border-subtle bg-surface-raised text-foreground sm:h-10 sm:w-10"
            >
              <SettingsIcon />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              side="top"
              sideOffset={8}
              className="z-20 flex w-72 flex-col gap-4 rounded-lg border border-border-strong bg-surface-raised p-4 text-sm shadow-lg"
            >
              <p className="font-data text-xs font-medium uppercase tracking-wider text-muted-foreground">{dict.settings}</p>

              <label className="flex items-center justify-between gap-2 text-foreground">
                {dict.showCaptions}
                <input type="checkbox" checked={captionsVisible} onChange={(event) => setCaptionsVisible(event.target.checked)} />
              </label>

              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{dict.captionContentLabel}</legend>
                {(["both", "translated-only"] as CaptionMode[]).map((mode) => (
                  <label key={mode} className="flex items-center gap-2 text-foreground">
                    <input type="radio" name="caption-mode" checked={captionMode === mode} onChange={() => setCaptionMode(mode)} />
                    {mode === "both" ? dict.captionModeBoth : dict.captionModeTranslatedOnly}
                  </label>
                ))}
              </fieldset>

              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{dict.captionPositionLabel}</legend>
                {(["bottom", "top"] as CaptionPosition[]).map((position) => (
                  <label key={position} className="flex items-center gap-2 text-foreground">
                    <input type="radio" name="caption-position" checked={captionPosition === position} onChange={() => setCaptionPosition(position)} />
                    {position === "bottom" ? dict.captionPositionBottom : dict.captionPositionTop}
                  </label>
                ))}
              </fieldset>

              {role === "facilitator" && (
                <label className="flex items-center justify-between gap-2 border-t border-border-subtle pt-3 text-foreground">
                  <span>{dict.allowLearnerPresenting}</span>
                  <input
                    type="checkbox"
                    checked={allowLearnerPresenting}
                    onChange={(event) => void togglePresenterAccess(event.target.checked)}
                  />
                </label>
              )}

              {pipSupported && (
                <button
                  type="button"
                  onClick={() => pipController.current?.enter()}
                  className="font-data rounded-md border border-border-strong px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-foreground hover:border-accent"
                >
                  {dict.pictureInPicture}
                </button>
              )}

              <Popover.Arrow style={{ fill: "var(--surface-raised)" }} />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>

        <Tooltip.Root delayDuration={300}>
          <Tooltip.Trigger asChild>
            <button
              type="button"
              onClick={handleLeave}
              disabled={leaveButtonProps.disabled}
              aria-label={dict.leave}
              className="flex h-9 w-9 items-center justify-center rounded-full sm:h-10 sm:w-10"
              style={{ background: "var(--tick-low)", color: "#fff" }}
            >
              <LeaveIcon />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              side="top"
              sideOffset={6}
              className="font-data z-20 rounded-md border border-border-strong bg-surface-raised px-2 py-1 text-[0.6875rem] uppercase tracking-wider text-foreground shadow-sm"
            >
              {dict.leave}
              <Tooltip.Arrow style={{ fill: "var(--surface-raised)" }} />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </div>
    </Tooltip.Provider>
  );
}
