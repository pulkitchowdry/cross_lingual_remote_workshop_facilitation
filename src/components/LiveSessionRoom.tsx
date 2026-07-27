"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LiveKitRoom, RoomAudioRenderer, useDataChannel, useLocalParticipant } from "@livekit/components-react";
import "@livekit/components-styles";
import { DisconnectReason, type MediaDeviceFailure } from "livekit-client";
import { MeetingRoom } from "@/components/meeting/MeetingRoom";
import type { MeetingChatMessage, MeetingTranscriptSegment } from "@/components/meeting/types";
import type { PrivateRecipientOption } from "@/components/SessionChatPanel";
import { getDictionary } from "@/lib/i18n";
import type { FormActionResult, SupportedLanguage } from "@/lib/session-contracts";
import type { FacilitatorAnalyticsView } from "@/lib/facilitator-analytics-view";

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
 * Mirrors the local participant's actual mic/camera/screen-share state (as
 * toggled via MeetingToolbar's own `useTrackToggle` calls, deep inside
 * `<MeetingRoom>`) back up to `LiveSessionRoom`, so a later forced reconnect
 * (see `publishState` below) can restore it instead of resetting to fixed
 * defaults. Must render inside `<LiveKitRoom>` to reach room context; renders
 * nothing itself.
 */
function PublishStateTracker({ onChange }: { onChange: (patch: PublishState) => void }) {
  const { isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } = useLocalParticipant();
  useEffect(() => {
    onChange({ audio: isMicrophoneEnabled, video: isCameraEnabled, screen: isScreenShareEnabled });
  }, [isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled, onChange]);
  return null;
}

export function LiveSessionRoom({
  sessionId,
  role,
  lang,
  targetLanguage,
  transcript,
  messages,
  sendChatAction,
  allowQuestions,
  title,
  inviteLink,
  viewerIsFacilitator,
  viewerUserId,
  canMessageFacilitatorPrivately,
  privateRecipientOptions,
  currentLanguage,
  onChangeLanguage,
  languageOptions,
  captionsHeader,
  captionComposer,
  analyticsView,
}: {
  sessionId: string;
  role: Role;
  lang: SupportedLanguage;
  targetLanguage: string;
  transcript: MeetingTranscriptSegment[];
  messages: MeetingChatMessage[];
  sendChatAction: (prevState: FormActionResult, formData: FormData) => Promise<FormActionResult>;
  allowQuestions?: boolean;
  title: string;
  inviteLink?: string | null;
  viewerIsFacilitator?: boolean;
  viewerUserId?: string;
  canMessageFacilitatorPrivately?: boolean;
  privateRecipientOptions?: PrivateRecipientOption[];
  currentLanguage: SupportedLanguage;
  onChangeLanguage: (lang: SupportedLanguage) => Promise<void>;
  languageOptions?: readonly { value: SupportedLanguage; nativeLabel: string }[];
  /** Above the captions feed — the "play translated audio" opt-in control. */
  captionsHeader?: ReactNode;
  /** Below the captions feed — the typed-caption composer. */
  captionComposer?: ReactNode;
  /** Facilitator-only "Analytics" sidebar tab (see MeetingSidebar) — omitted entirely for learners. */
  analyticsView?: FacilitatorAnalyticsView;
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
  // The actual mic/camera/screen-share state the local participant currently has
  // published — kept in sync by PublishStateTracker (above), which reads it
  // straight off the LiveKit room. A forced reconnect (the token-refresh effect
  // below) remounts <LiveKitRoom> (its `key` is `credentials.token`), which
  // re-runs its own connect-time auto-publish using whatever audio/video/screen
  // props it's given *at that moment* — reading this state there (instead of
  // fixed constants) is what makes a reconnect preserve rather than reset an
  // active mic/screen-share, or a camera the user had explicitly turned off.
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
  // closes over nothing else) avoids giving any downstream consumer (PublishStateTracker,
  // handleMediaDeviceFailure below) a new function reference on every render.
  // Set when a per-device capture failure (denied permission, no such device, device
  // held by another app) is recovered from by turning that one device off instead of
  // treating the whole room as unrecoverable — see handleMediaDeviceFailure below.
  // Cleared either once the participant successfully turns the same device back on (a
  // retry that works, e.g. after granting permission in the browser's own UI) or after
  // a fixed delay (see showDeviceWarning below) — a permanently-unavailable device
  // (no camera on this machine at all, permission denied for good) has no "turns it
  // back on" event to ever fire, and without the timeout this banner sat on screen for
  // the rest of the call.
  const [deviceWarning, setDeviceWarning] = useState<string | null>(null);
  const deviceWarningTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearDeviceWarningTimeout = useCallback(() => {
    if (deviceWarningTimeoutRef.current !== null) {
      clearTimeout(deviceWarningTimeoutRef.current);
      deviceWarningTimeoutRef.current = null;
    }
  }, []);
  const showDeviceWarning = useCallback(
    (message: string) => {
      setDeviceWarning(message);
      clearDeviceWarningTimeout();
      deviceWarningTimeoutRef.current = setTimeout(() => setDeviceWarning(null), 6_000);
    },
    [clearDeviceWarningTimeout],
  );
  useEffect(() => clearDeviceWarningTimeout, [clearDeviceWarningTimeout]);
  const handlePublishStateChange = useCallback(
    (patch: Partial<PublishState>) => {
      setPublishState((prev) => ({ ...prev, ...patch }));
      // The facilitator manually restarting their share is the one signal that clears
      // the interruption notice below — not a timeout, since there's no way to know in
      // advance how long they'll take to notice and click the button again.
      if (patch.screen) setScreenShareInterrupted(false);
      if (patch.video || patch.audio) {
        setDeviceWarning(null);
        clearDeviceWarningTimeout();
      }
    },
    [clearDeviceWarningTimeout],
  );
  // Set the instant the user clicks Leave (MeetingToolbar's handleLeave), before
  // `room.disconnect()` itself runs — distinct from a network-triggered disconnect,
  // which must still reconnect normally. Read by the refresh effect below so a
  // background token refresh (interval/'visibilitychange'/'online', all of which
  // keep running regardless of what the user did with the room in the meantime)
  // can't remount <LiveKitRoom> and silently rejoin someone who explicitly left.
  const hasLeftRef = useRef(false);
  // Set on a *terminal* disconnect/error the room has no path to recover from on its
  // own (livekit-client already retries transient network drops internally without
  // ever firing these callbacks) — without this, <LiveKitRoom> just unmounts its
  // children (falling through to a blank space where the video was) with nothing
  // telling the user why or what to do, for the rest of the page's lifetime.
  const [fatalError, setFatalError] = useState<string | null>(null);
  const handleDisconnected = useCallback(
    (reason?: DisconnectReason) => {
      if (reason === DisconnectReason.CLIENT_INITIATED) {
        hasLeftRef.current = true;
        return;
      }
      if (hasLeftRef.current) return;
      setFatalError(reason === DisconnectReason.DUPLICATE_IDENTITY ? dict.disconnectedDuplicate : dict.disconnectedOther);
    },
    [dict.disconnectedDuplicate, dict.disconnectedOther],
  );
  const handleRoomError = useCallback(() => setFatalError(dict.unableToJoin), [dict.unableToJoin]);
  // NOT routed through `fatalError` for a per-device failure, deliberately — this
  // fires for a single track's device problem (mic permission denied, camera already
  // in use elsewhere, no such device), most commonly from a manual toggle click via
  // MeetingToolbar's own device controls, but also from <LiveKitRoom>'s own
  // connect-time auto-publish (`publishState` defaults to `video: true` on every
  // connect/reconnect). The room itself is still perfectly healthy; treating every
  // device failure as fatal (as an earlier version did) unmounts <LiveKitRoom> over
  // it, which disconnects the whole call — turning "you denied the mic prompt" into
  // "the meeting shut down." `failure`/`kind` (from the SDK's own MediaDeviceFailure
  // classification) tell us exactly which device the capture attempt was for; for a
  // camera or microphone specifically, turn just that device off (so the next
  // render/reconnect stops re-requesting it) and show a dismissible warning instead —
  // cleared either once the participant successfully turns that same device back on
  // (handlePublishStateChange's own `setDeviceWarning(null)` above) or after a fixed
  // delay regardless (showDeviceWarning's own timeout), since a permanently-unavailable
  // device (no camera at all, permission denied for good) never fires the former. The
  // participant can still join audio/video-off, and the fatalError branch's "Rejoin"
  // button wouldn't have fixed this anyway, since it doesn't reset the browser's
  // already-made permission decision either. Any other failure kind (or none
  // reported) has no known-safe per-device recovery, so it still falls back to the
  // original terminal path.
  const handleMediaDeviceFailure = useCallback(
    (_failure?: MediaDeviceFailure, kind?: MediaDeviceKind) => {
      if (kind === "videoinput") {
        setPublishState((prev) => ({ ...prev, video: false }));
        showDeviceWarning(dict.cameraUnavailable);
        return;
      }
      if (kind === "audioinput") {
        setPublishState((prev) => ({ ...prev, audio: false }));
        showDeviceWarning(dict.microphoneUnavailable);
        return;
      }
      setFatalError(dict.mediaDeviceError);
    },
    [dict.cameraUnavailable, dict.microphoneUnavailable, dict.mediaDeviceError, showDeviceWarning],
  );

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
        // `hasLeftRef` is set synchronously at that moment (see handleDisconnected), but
        // this `fetch` was already past `maybeRefresh`'s pre-start check by then. Applying
        // a stale in-flight refresh's result here would still remount <LiveKitRoom> (its
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
  // The fatalError screen's one recourse used to be `window.location.reload()` — a
  // full page navigation. That's a heavier hammer than needed (and slower to recover
  // from) for a terminal disconnect/room error that a fresh token can often just fix
  // outright: clearing `fatalError` re-enables the background-refresh effect above,
  // and re-fetching credentials here gets a new token applied via <LiveKitRoom>'s
  // `key` remounting it, the same mechanism the background refresh itself already
  // relies on — no full reload needed for what's fundamentally the same recovery.
  const handleRejoin = useCallback(() => {
    setFatalError(null);
    void fetchCredentials({ background: false });
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
    // A terminal `fatalError` means <LiveKitRoom> isn't mounted (see the render
    // branch below) and won't be again until the "Rejoin" button explicitly clears
    // it — this effect's whole purpose is applying a fresh token to that mounted
    // room, so there's nothing for a background refresh to do, and every tick would
    // otherwise just be a wasted authenticated hit to /api/livekit/token forever.
    if (!credentials || fatalError) return;
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
  }, [credentials, fatalError, fetchCredentials]);

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
          onClick={handleRejoin}
          className="rounded-md border border-border-strong px-4 py-2 text-xs font-medium uppercase tracking-wider text-foreground"
        >
          {dict.rejoin}
        </button>
      </div>
    );
  }
  if (!credentials) {
    return <p className="text-sm text-muted-foreground">{dict.connecting}</p>;
  }

  const dashboardHref = `/sessions/${sessionId}/${role === "facilitator" ? "facilitator" : "learn"}`;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-surface">
      {deviceWarning && (
        <p role="status" className="px-3 py-1.5 text-xs" style={{ color: "var(--tick-low)" }}>
          {deviceWarning}
        </p>
      )}
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
        className="flex h-full min-h-0 flex-col"
      >
        <MeetingRoom
          sessionId={sessionId}
          role={role}
          uiLang={lang}
          targetLanguage={targetLanguage}
          transcript={transcript}
          messages={messages}
          sendChatAction={sendChatAction}
          allowQuestions={allowQuestions}
          dashboardHref={dashboardHref}
          title={title}
          inviteLink={inviteLink}
          viewerIsFacilitator={viewerIsFacilitator}
          viewerUserId={viewerUserId}
          canMessageFacilitatorPrivately={canMessageFacilitatorPrivately}
          privateRecipientOptions={privateRecipientOptions}
          currentLanguage={currentLanguage}
          onChangeLanguage={onChangeLanguage}
          languageOptions={languageOptions}
          captionsHeader={captionsHeader}
          captionComposer={captionComposer}
          analyticsView={analyticsView}
        />
        <PublishStateTracker onChange={handlePublishStateChange} />
        <RoomAudioRenderer />
        <CaptionChannelRefresher />
      </LiveKitRoom>
    </div>
  );
}
