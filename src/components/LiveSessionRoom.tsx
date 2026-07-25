"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CarouselLayout,
  ControlBar,
  FocusLayout,
  FocusLayoutContainer,
  GridLayout,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useDataChannel,
  useTracks,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { Track } from "livekit-client";
import { getDictionary } from "@/lib/i18n";
import "@/lib/media-devices";
import type { SupportedLanguage } from "@/lib/session-contracts";

/**
 * Refreshes the page as soon as a `notifyCaptionsChanged` DataChannel message
 * arrives, so captions land near-instantly instead of waiting for the next
 * `SessionAutoRefresh` poll. Must render inside `<LiveKitRoom>` to reach room
 * context; renders nothing itself.
 */
function CaptionChannelRefresher() {
  const router = useRouter();
  useDataChannel("captions", () => router.refresh());
  return null;
}

type Role = "facilitator" | "learner";

interface RoomCredentials {
  serverUrl: string;
  token: string;
}

/**
 * `issueCredential` (room.ts) mints a 6h-TTL token. Refreshing (and remounting
 * `<LiveKitRoom>` to actually apply it — see the `key` below) forces a brief
 * reconnect, so this only runs on a long interval as a courtesy for a session
 * left open well past a normal workshop's length; 5h stays safely inside the
 * 6h grant even if a refresh is missed. The interval alone won't catch a
 * laptop-sleep reconnect though (timers don't fire while suspended), so the
 * 'visibilitychange'/'online' listeners below are what actually cover the
 * failure scenario this fixes.
 */
const TOKEN_REFRESH_INTERVAL_MS = 5 * 60 * 60 * 1000;
/** Floor between refreshes triggered by 'visibilitychange'/'online' so rapid tab-focus flapping doesn't force a remount on every switch. */
const MIN_REFRESH_GAP_MS = 5 * 60 * 1000;

/**
 * Only the facilitator's ControlBar exposes the screen-share toggle — the
 * room stays bidirectional for audio/video (see room.ts), but screen sharing
 * is a facilitator-to-group broadcast, not a peer-to-peer one, so learners
 * don't get the control.
 */
function WorkshopVideoStage({ role }: { role: Role }) {
  // LiveKitRoom auto-publishes video but never audio (`audio={false}` below),
  // so the browser only ever prompts for camera permission on connect. Without
  // mic permission, `navigator.mediaDevices.enumerateDevices()` — which
  // ControlBar's device menus call internally — returns every audio input
  // with the same blank label and the same deviceId ("" pre-permission), and
  // the same can happen for video inputs if camera permission is denied.
  // Requesting (and immediately releasing) both permissions here makes the
  // browser report real per-device labels/IDs — publishing stays governed by
  // the `audio`/`video` props above, only the permission prompts change.
  //
  // This does NOT cover every cause of ControlBar's "two children with the
  // same key" warning, though: some drivers report two real, distinct
  // devices under one identical deviceId even with permission granted (see
  // `dedupeEnumerateDevices` in `@/lib/media-devices`, imported above for
  // that reason) — two earlier fixes here assumed permission state was the
  // only cause and didn't hold up.
  useEffect(() => {
    navigator.mediaDevices
      ?.getUserMedia({ audio: true, video: true })
      .then((stream) => stream.getTracks().forEach((track) => track.stop()))
      .catch(() => {
        // Permission denial only degrades device-menu labels, not the call.
      });
  }, []);

  const tracks = useTracks([
    { source: Track.Source.Camera, withPlaceholder: true },
    { source: Track.Source.ScreenShare, withPlaceholder: false },
  ]);
  const screenShareTrack = tracks.find((track) => track.source === Track.Source.ScreenShare);
  const cameraTracks = tracks.filter((track) => track.source === Track.Source.Camera);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 overflow-hidden p-3">
        {screenShareTrack ? (
          <FocusLayoutContainer className="h-full">
            <FocusLayout trackRef={screenShareTrack} />
            <CarouselLayout tracks={cameraTracks}>
              <ParticipantTile />
            </CarouselLayout>
          </FocusLayoutContainer>
        ) : (
          <GridLayout tracks={cameraTracks} className="h-full">
            <ParticipantTile />
          </GridLayout>
        )}
      </div>
      <div className="overflow-x-auto border-t border-border-subtle p-2">
        <ControlBar
          variation="minimal"
          controls={{ microphone: true, camera: true, chat: false, screenShare: role === "facilitator", leave: true }}
        />
      </div>
    </div>
  );
}

export function LiveSessionRoom({ sessionId, role, lang }: { sessionId: string; role: Role; lang: SupportedLanguage }) {
  const dict = getDictionary(lang).room;
  const [credentials, setCredentials] = useState<RoomCredentials | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastFetchedAtRef = useRef(0);

  const fetchCredentials = useCallback(
    async ({ background }: { background: boolean }) => {
      try {
        const response = await fetch("/api/livekit/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, role }),
        });
        const payload = (await response.json()) as RoomCredentials & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? dict.unableToJoin);
        lastFetchedAtRef.current = Date.now();
        setCredentials(payload);
        if (!background) setError(null);
      } catch (reason) {
        // A background refresh failing (e.g. a transient network blip) must not tear
        // down an otherwise-healthy connection by clearing `credentials` or surfacing
        // an error over the live video — only report failures from the initial join.
        if (!background) setError(reason instanceof Error ? reason.message : dict.unableToJoin);
      }
    },
    [role, sessionId, dict.unableToJoin],
  );

  useEffect(() => {
    // Fetches from an external system (the token endpoint) on mount/role change — the
    // rule can't see that `fetchCredentials` only sets state from the async response,
    // not synchronously in the effect body itself.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchCredentials({ background: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, sessionId]);

  // Proactively re-fetch a fresh token well before the 6h TTL, and immediately on
  // wake — 'visibilitychange'/'online' catch the laptop-sleep case the interval
  // alone would miss (timers don't fire while suspended, so without this the first
  // reconnect after waking could still be carrying an hours-stale token). The fresh
  // token is applied by remounting <LiveKitRoom> below (see its `key`), which forces
  // a clean reconnect using it — livekit-client's own automatic reconnect logic
  // doesn't pick up a token handed to it via a changed prop while already connected.
  useEffect(() => {
    if (!credentials) return;
    const maybeRefresh = (background: boolean) => {
      if (Date.now() - lastFetchedAtRef.current < MIN_REFRESH_GAP_MS) return;
      void fetchCredentials({ background });
    };
    const interval = setInterval(() => maybeRefresh(true), TOKEN_REFRESH_INTERVAL_MS);
    const onWake = () => maybeRefresh(true);
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onWake);
    };
  }, [credentials, fetchCredentials]);

  if (error) {
    return <p className="text-sm" style={{ color: "var(--tick-low)" }}>{error}</p>;
  }
  if (!credentials) {
    return <p className="text-sm text-muted-foreground">{dict.connecting}</p>;
  }

  return (
    <div className="h-[38rem] overflow-hidden rounded-lg border border-border-subtle bg-surface">
      <LiveKitRoom
        key={credentials.token}
        token={credentials.token}
        serverUrl={credentials.serverUrl}
        connect
        audio={false}
        video
        data-lk-theme="default"
      >
        <WorkshopVideoStage role={role} />
        <RoomAudioRenderer />
        <CaptionChannelRefresher />
      </LiveKitRoom>
    </div>
  );
}
