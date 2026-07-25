"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CarouselLayout,
  DisconnectButton,
  FocusLayout,
  FocusLayoutContainer,
  GridLayout,
  LeaveIcon,
  LiveKitRoom,
  MediaDeviceMenu,
  ParticipantTile,
  RoomAudioRenderer,
  TrackToggle,
  useDataChannel,
  useTracks,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { DisconnectReason, Track } from "livekit-client";
import { getDictionary } from "@/lib/i18n";
import "@/lib/media-devices";
import type { SupportedLanguage } from "@/lib/session-contracts";

type RoomDict = ReturnType<typeof getDictionary>["room"];

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

/** What `<LiveKitRoom>` should (re)publish on (re)connect — see the comment on `publishState` below. */
interface PublishState {
  audio: boolean;
  video: boolean;
  screen: boolean;
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
 * A FAILED background refresh (e.g. a transient network blip) must not just sit
 * there until the next multi-hour interval tick or a visibility/online event —
 * on a tab that stays focused and online the whole time, that event may never
 * come before the 6h token actually expires. Retrying soon, a few times, gives a
 * transient blip a real chance to recover well inside that window.
 */
const BACKGROUND_REFRESH_RETRY_DELAY_MS = 60 * 1000;
/** Caps the retry chain so a genuine outage (vs. a transient blip) falls back to the normal interval/wake cadence instead of hammering the token endpoint forever. */
const MAX_BACKGROUND_REFRESH_RETRIES = 3;

/**
 * Only the facilitator gets the screen-share toggle — the room stays
 * bidirectional for audio/video (see room.ts), but screen sharing is a
 * facilitator-to-group broadcast, not a peer-to-peer one, so learners don't
 * get the control. Controls are hand-rolled (rather than LiveKit's stock
 * `ControlBar`) so each button's aria-label can come from `dict`.
 */
function WorkshopVideoStage({
  role,
  dict,
  onPublishStateChange,
  onScreenShareActiveChange,
  onLeave,
}: {
  role: Role;
  dict: RoomDict;
  /** Reports the local participant's actual mic/camera/screen-share state after every change, so a later forced reconnect (see `publishState` below) can restore it instead of resetting to fixed defaults. */
  onPublishStateChange: (patch: Partial<PublishState>) => void;
  /** Reports whether ANY participant's screen share is currently live in the room (not just the local one) — the page grid uses this to let the video column grow toward full width while something is actively being presented, instead of staying capped at its idle share. */
  onScreenShareActiveChange?: (active: boolean) => void;
  /** Fired when the user explicitly clicks Leave, distinct from a network-triggered disconnect — see `hasLeftRef` below. */
  onLeave: () => void;
}) {
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

  const isScreenShareActive = Boolean(screenShareTrack);
  useEffect(() => {
    onScreenShareActiveChange?.(isScreenShareActive);
  }, [isScreenShareActive, onScreenShareActiveChange]);

  // `useTrackToggle` (which `<TrackToggle>` wraps) re-runs an internal effect whose
  // dependency array includes this `onChange` reference every time it changes — an
  // inline arrow function here would be a new reference on every render, so that
  // effect fires again, which calls `onPublishStateChange`, which (via LiveSessionRoom's
  // `setPublishState`) re-renders this component, creating yet another new inline
  // function: an infinite render loop ("Maximum update depth exceeded"), reproduced
  // and confirmed live in the browser. `useCallback` keeps each handler's identity
  // stable across renders as long as `onPublishStateChange` itself is stable (it is —
  // see LiveSessionRoom's own `useCallback` around `setPublishState`).
  const handleMicrophoneChange = useCallback(
    (enabled: boolean) => onPublishStateChange({ audio: enabled }),
    [onPublishStateChange],
  );
  const handleCameraChange = useCallback(
    (enabled: boolean) => onPublishStateChange({ video: enabled }),
    [onPublishStateChange],
  );
  const handleScreenShareChange = useCallback(
    (enabled: boolean) => onPublishStateChange({ screen: enabled }),
    [onPublishStateChange],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 overflow-hidden p-2">
        {screenShareTrack ? (
          // FocusLayoutContainer expects its FIRST child to be the small side
          // carousel and its SECOND child to be the large focused tile — its
          // own CSS (.lk-focus-layout { grid-template-columns: 1fr 5fr }) hands
          // the first DOM child the narrow 1fr column. Screen share must go
          // second (the 5fr column) or it renders as the small tile with the
          // camera carousel blown up huge instead — the inverse of "screen
          // share is always the biggest".
          <FocusLayoutContainer className="h-full">
            <CarouselLayout tracks={cameraTracks}>
              <ParticipantTile />
            </CarouselLayout>
            <FocusLayout trackRef={screenShareTrack} />
          </FocusLayoutContainer>
        ) : (
          <GridLayout tracks={cameraTracks} className="h-full">
            <ParticipantTile />
          </GridLayout>
        )}
      </div>
      <div className="relative z-10 flex flex-wrap items-center justify-center gap-2 border-t border-border-subtle p-2">
        <div className="lk-button-group">
          <TrackToggle source={Track.Source.Microphone} aria-label={dict.toggleMicrophone} onChange={handleMicrophoneChange} />
          <div className="lk-button-group-menu">
            <MediaDeviceMenu kind="audioinput" aria-label={dict.selectMicrophone} />
          </div>
        </div>
        <div className="lk-button-group">
          <TrackToggle source={Track.Source.Camera} aria-label={dict.toggleCamera} onChange={handleCameraChange} />
          <div className="lk-button-group-menu">
            <MediaDeviceMenu kind="videoinput" aria-label={dict.selectCamera} />
          </div>
        </div>
        {role === "facilitator" && (
          <TrackToggle
            source={Track.Source.ScreenShare}
            aria-label={dict.toggleScreenShare}
            onChange={handleScreenShareChange}
            // Without this, getDisplayMedia() captures video only — the token still
            // grants screen-share-audio publish rights (room.ts), but nothing ever
            // requests the browser's shared-tab/system audio to begin with, so
            // learners never hear it regardless of what the token allows.
            captureOptions={{ audio: true }}
          />
        )}
        <DisconnectButton aria-label={dict.leaveCall} onClick={onLeave}>
          <LeaveIcon />
        </DisconnectButton>
      </div>
    </div>
  );
}

export function LiveSessionRoom({
  sessionId,
  role,
  lang,
  onScreenShareActiveChange,
}: {
  sessionId: string;
  role: Role;
  lang: SupportedLanguage;
  /** See the matching prop on `WorkshopVideoStage` — bubbled straight through so the page grid wrapping this component can react to it. */
  onScreenShareActiveChange?: (active: boolean) => void;
}) {
  const dict = getDictionary(lang).room;
  const [credentials, setCredentials] = useState<RoomCredentials | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastFetchedAtRef = useRef(0);
  // Bounded retry chain for a FAILED background refresh (see fetchCredentials's
  // catch block) — reset to 0 at the start of each new root-triggered attempt (in
  // maybeRefresh below) so every independent trigger gets its own full budget,
  // not just the first one after a long healthy stretch.
  const backgroundRetryCountRef = useRef(0);
  // Holds the pending retry's timer ID so the refresh effect below can cancel it
  // (alongside its own interval/listeners) if `fetchCredentials` changes identity
  // or the component unmounts before it fires.
  const backgroundRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // `fetchCredentials` schedules its own retry (see its catch block below), but
  // referencing that `const` by name from inside its own body would depend on a
  // declaration that isn't finished yet. Routing through a ref kept in sync after
  // every render (just below) sidesteps that while still always calling whichever
  // version is current.
  const fetchCredentialsRef = useRef<((args: { background: boolean }) => Promise<void>) | null>(null);
  // The actual mic/camera/screen-share state the local participant currently wants
  // published — starts at the same defaults <LiveKitRoom> always auto-published
  // before this existed (mic off, camera on, no screen share), but tracks every
  // toggle via WorkshopVideoStage's TrackToggle onChange handlers from then on.
  // A forced reconnect (the token-refresh effect below) remounts <LiveKitRoom>
  // (its `key` is `credentials.token`), which re-runs its own connect-time
  // auto-publish using whatever audio/video/screen props it's given *at that
  // moment* — reading this state there (instead of fixed constants) is what makes
  // a reconnect preserve rather than reset an active mic/screen-share, or a camera
  // the user had explicitly turned off. State, not a ref, deliberately — reading a
  // ref's `.current` during render (as the JSX below does) isn't safe, and a toggle
  // here re-rendering this component doesn't remount <LiveKitRoom> (its `key`
  // doesn't change), so it doesn't cost an extra reconnect.
  const [publishState, setPublishState] = useState<PublishState>({ audio: false, video: true, screen: false });
  // A background token refresh remounts <LiveKitRoom> (its `key` is
  // `credentials.token`), which reruns its own connect-time auto-publish for
  // `screen={publishState.screen}` — but `getDisplayMedia()` always requires a user
  // gesture, which a timer/'online'/'visibilitychange'-triggered reconnect never has.
  // Read via a ref (not the `publishState` state value) inside `fetchCredentials`
  // below so that callback doesn't need `publishState` in its dependency array —
  // this only needs the *current* value at the moment a background refresh lands,
  // not to re-run whenever publishState changes.
  const publishStateRef = useRef(publishState);
  useEffect(() => {
    publishStateRef.current = publishState;
  }, [publishState]);
  const [screenShareInterrupted, setScreenShareInterrupted] = useState(false);
  // Stable identity (empty deps — `setPublishState` itself is already stable, and this
  // closes over nothing else) is what lets WorkshopVideoStage's own `useCallback`s stay
  // stable too, which is what actually avoids the infinite-render loop described below —
  // an inline arrow function here would defeat that regardless of memoizing downstream.
  const handlePublishStateChange = useCallback((patch: Partial<PublishState>) => {
    setPublishState((prev) => ({ ...prev, ...patch }));
    // The facilitator manually restarting their share is the one signal that clears
    // the interruption notice below — not a timeout, since there's no way to know in
    // advance how long they'll take to notice and click the button again.
    if (patch.screen) setScreenShareInterrupted(false);
  }, []);
  // Set the instant the user clicks Leave (see WorkshopVideoStage's onLeave), before
  // `room.disconnect()` itself runs — distinct from a network-triggered disconnect,
  // which must still reconnect normally. Read by the refresh effect below so a
  // background token refresh (interval/'visibilitychange'/'online', all of which
  // keep running regardless of what the user did with the room in the meantime)
  // can't remount <LiveKitRoom> and silently rejoin someone who explicitly left.
  const hasLeftRef = useRef(false);
  const handleLeave = useCallback(() => {
    hasLeftRef.current = true;
  }, []);
  // Set on a *terminal* disconnect/error the room has no path to recover from on its
  // own (livekit-client already retries transient network drops internally without
  // ever firing these callbacks) — without this, <LiveKitRoom> just unmounts its
  // children (falling through to a blank space where the video was) with nothing
  // telling the user why or what to do, for the rest of the page's lifetime.
  const [fatalError, setFatalError] = useState<string | null>(null);
  const handleDisconnected = useCallback(
    (reason?: DisconnectReason) => {
      if (hasLeftRef.current || reason === DisconnectReason.CLIENT_INITIATED) return;
      setFatalError(reason === DisconnectReason.DUPLICATE_IDENTITY ? dict.disconnectedDuplicate : dict.disconnectedOther);
    },
    [dict.disconnectedDuplicate, dict.disconnectedOther],
  );
  const handleRoomError = useCallback(() => setFatalError(dict.unableToJoin), [dict.unableToJoin]);
  const handleMediaDeviceFailure = useCallback(() => setFatalError(dict.mediaDeviceError), [dict.mediaDeviceError]);

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
        // A background refresh can still be in flight when the user clicks Leave —
        // `hasLeftRef` is set synchronously at that moment (see handleLeave), but this
        // `fetch` was already past `maybeRefresh`'s pre-start check by then. Applying a
        // stale in-flight refresh's result here would still remount <LiveKitRoom> (its
        // `key` is `credentials.token`) and silently reconnect a room the user
        // explicitly, deliberately left moments earlier.
        if (hasLeftRef.current) return;
        // Also set on success (not just eagerly in `maybeRefresh` below) so the very
        // first, mount-time fetch — which doesn't go through `maybeRefresh` — still
        // establishes a baseline; otherwise a 'visibilitychange'/'online' firing soon
        // after mount would see the ref at its unset 0 and skip the debounce floor
        // entirely for that first background refresh.
        lastFetchedAtRef.current = Date.now();
        // A forced reconnect while screen-sharing can't actually resume it —
        // `getDisplayMedia()` always requires a user gesture, which none of this
        // component's reconnect triggers (a timer, 'online', 'visibilitychange') ever
        // have. Resetting `screen` here, before <LiveKitRoom> remounts with these new
        // credentials, stops it from even attempting (and silently failing) that
        // republish — the alternative (letting it try and catching the rejection after
        // the fact) depends on LiveKit's internal auto-publish/error-surfacing
        // behavior holding a specific shape across versions; this is deterministic.
        if (background) {
          const wasSharing = publishStateRef.current.screen;
          if (wasSharing) {
            setPublishState((prev) => ({ ...prev, screen: false }));
            setScreenShareInterrupted(true);
          }
        }
        setCredentials(payload);
        if (!background) setError(null);
      } catch (reason) {
        // A background refresh failing (e.g. a transient network blip) must not tear
        // down an otherwise-healthy connection by clearing `credentials` or surfacing
        // an error over the live video — only report failures from the initial join.
        if (!background) {
          setError(reason instanceof Error ? reason.message : dict.unableToJoin);
          return;
        }
        // Otherwise this failure would sit untouched until the next multi-hour
        // interval tick or a visibility/online event (see BACKGROUND_REFRESH_RETRY_DELAY_MS
        // above) — retry soon, independent of MIN_REFRESH_GAP_MS (that floor only
        // throttles *new* triggers, not this fetch's own recovery attempts).
        if (backgroundRetryCountRef.current < MAX_BACKGROUND_REFRESH_RETRIES) {
          backgroundRetryCountRef.current += 1;
          backgroundRetryTimeoutRef.current = setTimeout(() => {
            if (hasLeftRef.current) return;
            void fetchCredentialsRef.current?.({ background: true });
          }, BACKGROUND_REFRESH_RETRY_DELAY_MS);
        }
      }
    },
    [role, sessionId, dict.unableToJoin],
  );
  useEffect(() => {
    fetchCredentialsRef.current = fetchCredentials;
  }, [fetchCredentials]);

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
      if (hasLeftRef.current) return;
      if (Date.now() - lastFetchedAtRef.current < MIN_REFRESH_GAP_MS) return;
      // Set before the (async) fetch starts, not after it resolves — otherwise two
      // wake events firing close together (exactly the laptop-wake scenario this
      // targets: 'visibilitychange' and 'online' both firing) can each read a stale
      // `lastFetchedAtRef` and both pass this gap check, firing two concurrent
      // token fetches instead of the second one being correctly debounced.
      lastFetchedAtRef.current = Date.now();
      // Fresh retry budget for this new root-triggered attempt — a chain already
      // exhausted by an earlier failure shouldn't count against this independent one.
      backgroundRetryCountRef.current = 0;
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
      // Cancel a pending background-refresh retry (see fetchCredentials's catch
      // block) too — otherwise it could fire after `fetchCredentials` changes
      // identity or the component unmounts, wastefully hitting the token endpoint.
      if (backgroundRetryTimeoutRef.current !== null) clearTimeout(backgroundRetryTimeoutRef.current);
    };
  }, [credentials, fetchCredentials]);

  if (error) {
    return <p className="text-sm" style={{ color: "var(--tick-low)" }}>{error}</p>;
  }
  if (fatalError) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm" role="alert" style={{ color: "var(--tick-low)" }}>
          {fatalError}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md border border-border-strong px-4 py-2 text-xs font-medium uppercase tracking-wider text-foreground"
        >
          {dict.reload}
        </button>
      </div>
    );
  }
  if (!credentials) {
    return <p className="text-sm text-muted-foreground">{dict.connecting}</p>;
  }

  return (
    // Scales with viewport height (up to a point) instead of a flat 38rem, so the
    // room this component takes ~2/3 of the page width for (see the facilitator/
    // learner page grids) isn't stuck at a fixed, comparatively short height on
    // larger displays — clamped on both ends so it stays usable on short viewports
    // and doesn't grow unbounded on very tall ones. No `overflow-hidden` here (kept
    // as-is from the hand-rolled controls change) — MediaDeviceMenu's dropdown
    // needs to render outside these bounds.
    <div className="h-[clamp(26rem,75vh,54rem)] rounded-lg border border-border-subtle bg-surface">
      {screenShareInterrupted && (
        <p role="status" className="px-3 py-1.5 text-xs" style={{ color: "var(--tick-low)" }}>
          {dict.screenShareInterrupted}
        </p>
      )}
      <LiveKitRoom
        key={credentials.token}
        token={credentials.token}
        serverUrl={credentials.serverUrl}
        connect
        // Not fixed constants — a forced reconnect (the token-refresh effect above
        // changing `credentials.token`, which changes this `key`) must (re)publish
        // whatever the user's actual last mic/camera/screen-share state was.
        audio={publishState.audio}
        video={publishState.video}
        screen={publishState.screen}
        onDisconnected={handleDisconnected}
        onError={handleRoomError}
        onMediaDeviceFailure={handleMediaDeviceFailure}
        data-lk-theme="default"
      >
        <WorkshopVideoStage
          role={role}
          dict={dict}
          onPublishStateChange={handlePublishStateChange}
          onScreenShareActiveChange={onScreenShareActiveChange}
          onLeave={handleLeave}
        />
        <RoomAudioRenderer />
        <CaptionChannelRefresher />
      </LiveKitRoom>
    </div>
  );
}
