"use client";

import { useEffect, useRef } from "react";
import type { TrackReference, TrackReferenceOrPlaceholder } from "@livekit/components-core";
import { useMeetingShell } from "@/components/meeting/MeetingShellContext";

function realTrack(trackRef: TrackReferenceOrPlaceholder | undefined): TrackReference | undefined {
  return trackRef?.publication ? (trackRef as TrackReference) : undefined;
}

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
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pipWindowRef = useRef<Window | null>(null);

  useEffect(() => {
    const video = document.createElement("video");
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.style.width = "100%";
    video.style.height = "100%";
    video.style.objectFit = "contain";
    videoRef.current = video;
    return () => {
      pipWindowRef.current?.close();
    };
  }, []);

  useEffect(() => {
    const mediaTrack = realTrack(primaryTrack)?.publication.track?.mediaStreamTrack;
    if (videoRef.current) {
      videoRef.current.srcObject = mediaTrack ? new MediaStream([mediaTrack]) : null;
    }
  }, [primaryTrack]);

  useEffect(() => {
    async function enter() {
      if (typeof window === "undefined" || !window.documentPictureInPicture) return;
      if (!videoRef.current?.srcObject) return;
      if (pipWindowRef.current) return;
      try {
        const pipWindow = await window.documentPictureInPicture.requestWindow({ width: 320, height: 180 });
        pipWindowRef.current = pipWindow;
        pipWindow.document.body.style.margin = "0";
        pipWindow.document.body.style.background = "#000";
        pipWindow.document.body.append(videoRef.current!);
        pipWindow.addEventListener(
          "pagehide",
          () => {
            pipWindowRef.current = null;
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
