"use client";

import { useEffect } from "react";
import type { TrackReference, TrackReferenceOrPlaceholder } from "@livekit/components-core";
import { useMeetingShell } from "@/components/meeting/MeetingShellContext";

function realTrack(trackRef: TrackReferenceOrPlaceholder | undefined): TrackReference | undefined {
  return trackRef?.publication ? (trackRef as TrackReference) : undefined;
}

/**
 * Module-level (not per-instance ref) so an already-open Picture-in-Picture
 * window/video element survives this component remounting — this renders
 * inside `<LiveKitRoom key={credentials.token}>` (LiveSessionRoom.tsx), which
 * fully remounts on every forced token-refresh reconnect. A per-instance ref's
 * unmount cleanup used to unconditionally close the PiP window on every such
 * reconnect, even though the participant never asked to close it.
 * `pendingCloseTimeout` lets a same-tick remount (cleanup-then-mount both run
 * in one passive-effects flush for a key-based swap) cancel the deferred close
 * before it fires, while a genuine unmount (leaving the room for good) still
 * closes it a tick later.
 */
let sharedPipWindow: Window | null = null;
let sharedVideoEl: HTMLVideoElement | null = null;
let pendingCloseTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Mirrors the meeting's primary video (screen-share, or the local camera as
 * a fallback) into a plain, LiveKit-independent <video> element that can be
 * handed to the browser's Document Picture-in-Picture window. Renders
 * nothing itself — invoked either automatically on tab-hide (best-effort:
 * `documentPictureInPicture.requestWindow()` requires a user gesture in
 * Chromium, which a `visibilitychange` firing on tab-switch does not
 * reliably carry) or via the Settings popover's "Picture-in-picture" button,
 * whose click IS a qualifying gesture and is the one guaranteed-to-work path.
 */
export function AutoPictureInPicture({ primaryTrack }: { primaryTrack: TrackReferenceOrPlaceholder | undefined }) {
  const { pipController: pipControllerRef } = useMeetingShell();

  useEffect(() => {
    if (pendingCloseTimeout !== null) {
      clearTimeout(pendingCloseTimeout);
      pendingCloseTimeout = null;
    }
    if (!sharedVideoEl) {
      const video = document.createElement("video");
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.style.width = "100%";
      video.style.height = "100%";
      video.style.objectFit = "contain";
      sharedVideoEl = video;
    }
    return () => {
      // Deferred, and cancellable by the check above — a token-refresh remount
      // re-runs this same effect within the same passive-effects flush, well
      // before this timeout's callback gets a turn on the task queue.
      pendingCloseTimeout = setTimeout(() => {
        pendingCloseTimeout = null;
        sharedPipWindow?.close();
        sharedPipWindow = null;
        sharedVideoEl = null;
      }, 0);
    };
  }, []);

  useEffect(() => {
    const mediaTrack = realTrack(primaryTrack)?.publication.track?.mediaStreamTrack;
    if (sharedVideoEl) {
      sharedVideoEl.srcObject = mediaTrack ? new MediaStream([mediaTrack]) : null;
    }
  }, [primaryTrack]);

  useEffect(() => {
    async function enter() {
      if (typeof window === "undefined" || !window.documentPictureInPicture) return;
      if (!sharedVideoEl?.srcObject) return;
      if (sharedPipWindow) return;
      try {
        const pipWindow = await window.documentPictureInPicture.requestWindow({ width: 320, height: 180 });
        sharedPipWindow = pipWindow;
        pipWindow.document.body.style.margin = "0";
        pipWindow.document.body.style.background = "#000";
        pipWindow.document.body.append(sharedVideoEl!);
        pipWindow.addEventListener(
          "pagehide",
          () => {
            sharedPipWindow = null;
          },
          { once: true },
        );
      } catch {
        // Most likely a missing user gesture (see file-level comment) — the
        // Settings button remains the reliable fallback, so this stays silent.
      }
    }

    pipControllerRef.current = { enter: () => void enter() };

    function onVisibilityChange() {
      if (document.visibilityState === "hidden") void enter();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      pipControllerRef.current = null;
    };
  }, [pipControllerRef]);

  return null;
}
