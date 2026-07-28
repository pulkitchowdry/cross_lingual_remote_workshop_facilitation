"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConnectionQualityIndicator, useLocalParticipant } from "@livekit/components-react";
import { Track } from "livekit-client";
import { CAPTION_SOCKET_NORMAL_CLOSURE_CODE, decideCaptionSocketReconnect } from "@/lib/caption-socket-client";
import { getDictionary } from "@/lib/i18n";
import type { SupportedLanguage } from "@/lib/session-contracts";

const CHUNK_INTERVAL_MS = 250;

// A caption socket that drops for a reason the user didn't ask for (a Railway/proxy idle
// drop, a `web` service redeploy, a laptop waking from sleep, a transient STT-tier error)
// used to be terminal: the error rendered and capture stayed dead until the facilitator
// noticed and clicked Retry. Mid-workshop, that reads as "live captions just don't work."
// `decideCaptionSocketReconnect` (caption-socket-client.ts) owns the policy — which closes
// are transient enough to retry, and the backoff ladder — so it stays unit-testable
// without a live socket.

/**
 * Streams mic audio to `/api/captions/stream` over a WebSocket — true
 * streaming STT (Deepgram's live API, or local-inference's chunked
 * equivalent), for facilitator or learner alike. Short `MediaRecorder`
 * timeslices keep frames small enough for near-real-time transcription; the
 * server persists and DataChannel-pushes each final transcript as it
 * arrives.
 *
 * Tied directly to the participant's own LiveKit mic toggle (`useLocalParticipant`'s
 * `isMicrophoneEnabled`) rather than a separate "Start captions" button — unmuting to
 * speak is already the one action every participant takes to be heard at all, so
 * requiring a second, independent click here (previously this component's only
 * trigger) was pure friction with no benefit. Renders a status indicator only, not a
 * button; the only remaining manual control is a "Retry" affordance if the socket
 * itself fails while the mic is still on.
 */
export function LiveCaptionStream({
  sessionId,
  lang,
  agentCapturing = false,
}: {
  sessionId: string;
  lang: SupportedLanguage;
  /**
   * True when the server-side caption agent (`caption-agent.ts`) is already
   * streaming this participant's mic track — it auto-subscribes as soon as
   * the ControlBar mic is unmuted. Starting this WebSocket path on top of
   * that would open a second, independent STT pipeline for the same audio,
   * duplicating every caption line (issue #95). When true, this never
   * auto-starts and instead shows a status notice.
   */
  agentCapturing?: boolean;
}) {
  useEffect(() => {
    console.log("[captions] LiveCaptionStream mounted");

    return () => {
      console.log("[captions] LiveCaptionStream unmounted");
    };
  }, []);
  const dict = getDictionary(lang).captions;
  const { isMicrophoneEnabled, localParticipant } = useLocalParticipant();
  // The Confidence Score's network signal (issue #130's "Future Enhancements") for this
  // participant's own captions — same live, reactive quality ParticipantChip already
  // shows in the meeting UI, just also reported to the server here. Read via a ref (not
  // `quality` directly) inside `recorder.ondataavailable` below: that callback is set up
  // once per `start()` call and would otherwise keep sending whatever quality was
  // current at that moment, not the live value.
  const { quality } = useConnectionQualityIndicator({ participant: localParticipant });
  const qualityRef = useRef(quality);
  useEffect(() => {
    qualityRef.current = quality;
  }, [quality]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const stoppedByUserRef = useRef(false);
  // Mirrors `isStreaming`/`isConnecting` for the auto-start effect below to read
  // synchronously — that effect only re-runs when `isMicrophoneEnabled`/`agentCapturing`
  // change, not on every streaming-state update, so it needs a way to check "is a
  // connection already in flight or established" without depending on (and re-firing
  // for) those state values themselves.
  const activeRef = useRef(false);
  /** Whether the current socket ever reached `OPEN` — see caption-socket-client.ts's "opaque" case. */
  const hasOpenedRef = useRef(false);
  // The full, untruncated error text from a server `{ type: "error", message }` data
  // frame (captions-socket.ts's onError sends this before closing) — the close frame
  // that follows immediately after carries the *same* message, but truncated to 123
  // bytes (WebSocket's close-reason limit; see captions-socket.ts's closeWithReason).
  // `onclose` below prefers this over the truncated `event.reason` when both exist for
  // the same connection, so a message cut off mid-sentence never clobbers the clear one.
  const lastServerMessageRef = useRef<string | null>(null);
  /** Pending automatic-reconnect timer, so `stop()` can cancel a retry that's already scheduled. */
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Consecutive failed connections, reset on every socket that reaches `OPEN`. */
  const reconnectAttemptsRef = useRef(0);
  /**
   * Lets `onclose` (registered inside `start`) call back into the latest `start` without
   * `start` having to depend on itself — a plain reference would be a circular
   * `useCallback` dependency.
   */
  const startRef = useRef<() => void>(() => {});
  const startingRef = useRef(false);
  // ─── TEMPORARY DIAGNOSTICS (remove alongside server.ts's `[captions/diag]` block) ───
  // The existing logs show START → SOCKET CLOSED with no timing at all, so there is no way
  // to tell a socket that died in 200ms (a handshake/auth-shaped failure) from one that
  // lived 30s (a liveness/proxy-shaped failure) — and those have opposite root causes.
  // These also record whether `MediaRecorder` ever produced a chunk, which decides whether
  // "no captions" is a capture problem or a transport problem.
  const startedAtRef = useRef(0);
  const openedAtRef = useRef(0);
  const chunksSentRef = useRef(0);
  const bytesSentRef = useRef(0);
  const diagRef = useRef(() => ({
    sinceStartMs: startedAtRef.current ? Date.now() - startedAtRef.current : null,
    sinceOpenMs: openedAtRef.current ? Date.now() - openedAtRef.current : null,
    chunksSent: chunksSentRef.current,
    bytesSent: bytesSentRef.current,
    visibility: typeof document === "undefined" ? "?" : document.visibilityState,
    online: typeof navigator === "undefined" ? "?" : navigator.onLine,
  }));
  // ─── end temporary diagnostics ───
  /**
   * Whether capture *should* still be running, mirrored for the same reason `qualityRef`
   * is: `onclose` is registered once per `start()` call, so reading these values directly
   * would test whatever they were when that socket opened. A reconnect must be decided
   * against live state — the mic being muted (or the server-side agent taking over) while
   * a socket was dying is exactly when a stale "yes, reconnect" would resurrect capture
   * the user just turned off.
   */
  const shouldCaptureRef = useRef(false);
  useEffect(() => {
    shouldCaptureRef.current = isMicrophoneEnabled && !agentCapturing;
  }, [isMicrophoneEnabled, agentCapturing]);
  /**
   * Read inside `acquireMicStream` at call time — deliberately NOT a dependency of
   * `start()` or the auto-start effect. Depending on the participant (or its
   * `microphoneTrack`) is what broke the previously-reverted attempt at this fix: those
   * references change identity on room events unrelated to the mic actually toggling,
   * re-firing the effect and producing a reconnect loop.
   */
  const localParticipantRef = useRef(localParticipant);
  useEffect(() => {
    localParticipantRef.current = localParticipant;
  }, [localParticipant]);

  /**
   * Prefers a **clone of the microphone track LiveKit already published** over opening a
   * second, independent capture of the same physical device.
   *
   * A second `getUserMedia({audio:true})` alongside LiveKit's own mic publication put two
   * captures on one device, which disturbs LiveKit's track enough to make it
   * unpublish/republish. `isMicrophoneEnabled` is derived from that publication
   * (`!publication?.isMuted ?? true`) and recomputes on `LocalTrackPublished`/
   * `LocalTrackUnpublished`/`TrackMuted`/`TrackUnmuted`/`MediaDevicesError` — so each flip
   * re-ran the auto-start effect, which called `stop()` then `start()`, which opened
   * another capture, which flipped it again. Observed in production as an endless
   * `superseding an older caption stream …` loop that no caption ever survived.
   *
   * This is learner-only in practice: a facilitator's `LiveCaptionStream` returns early on
   * `agentCapturing` (the server-side worker captures them instead) and so never opened a
   * second capture at all — exactly the asymmetry the bug showed.
   *
   * `clone()` yields an independent `MediaStreamTrack` backed by the same source, so
   * `stop()`ing it on teardown never stops the track LiveKit is still publishing, and no
   * new device capture is requested. Falls back to `getUserMedia` when there's no live
   * publication to clone (mic still initializing, or a non-LiveKit context).
   */
  const acquireMicStream = useCallback(async (): Promise<MediaStream> => {
    const published = localParticipantRef.current?.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack;
    if (published && published.readyState === "live") return new MediaStream([published.clone()]);
    return navigator.mediaDevices.getUserMedia({ audio: true });
  }, []);

  const stop = useCallback(() => {
    console.log("[captions] STOP");

    activeRef.current = false;
    stoppedByUserRef.current = true;
    hasOpenedRef.current = false;

    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    recorderRef.current?.stop();
    recorderRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    socketRef.current?.close();
    socketRef.current = null;

    setIsStreaming(false);
  }, []);

  useEffect(() => stop, [stop]);

  // The agent can start capturing (mic unmuted in ControlBar) after this WS path was
  // already streaming — e.g. the mic was unmuted moments before the agent's own
  // subscription caught up. Without this, both pipelines would keep running and
  // duplicating captions.
  useEffect(() => {
    // `stop()` tears down the socket/recorder/mic stream (external systems), not just
    // local state — a legitimate effect, not state that could be computed during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (agentCapturing && isStreaming) stop();
  }, [agentCapturing, isStreaming, stop]);

  const start = useCallback(async () => {
    // Prevent multiple concurrent start attempts.
    if (startingRef.current) {
      console.log("[captions] start ignored (already starting)");
      return;
    }

    const existing = socketRef.current;
    if (
      existing &&
      (existing.readyState === WebSocket.CONNECTING ||
        existing.readyState === WebSocket.OPEN)
    ) {
      console.log(
        "[captions] start ignored (socket already exists)",
        existing.readyState,
      );
      return;
    }

    startingRef.current = true;

    startedAtRef.current = Date.now();
    openedAtRef.current = 0;
    chunksSentRef.current = 0;
    bytesSentRef.current = 0;
    console.log("[captions] START", new Date().toISOString());

    activeRef.current = true;
    setError(null);
    stoppedByUserRef.current = false;
    hasOpenedRef.current = false;
    lastServerMessageRef.current = null;
    setIsConnecting(true);

    try {
      // Existing code...
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${window.location.host}/api/captions/stream?sessionId=${sessionId}`);
      socketRef.current = socket;
      socket.onopen = () => {
        // Same staleness guard as `onclose` below: a superseded socket reaching OPEN must
        // not claim `hasOpenedRef` (which decides "opaque" vs. "dropped" for the *current*
        // socket) or reset the current socket's backoff ladder.
        if (socketRef.current !== socket) return;
        openedAtRef.current = Date.now();
        console.log("[captions] SOCKET OPEN", diagRef.current());
        hasOpenedRef.current = true;
        // Reaching OPEN is the only real proof the path works end to end, so the backoff
        // ladder resets here rather than on a successful `start()` call — otherwise a
        // socket that opens and drops repeatedly would burn its 5 attempts once and never
        // reconnect again for the rest of the session.
        reconnectAttemptsRef.current = 0;
      };
      // `onclose` always fires right after and carries the actual signal (a
      // server-provided reason, or an abnormal closure) — nothing to add here.
      socket.onerror = () => {};
      socket.onmessage = (event) => {
        // A superseded socket's final error frame must not surface on the UI the newer,
        // healthy socket is now driving.
        if (socketRef.current !== socket) return;
        try {
          const payload = JSON.parse(event.data) as { type?: string; message?: string };
          if (payload.type === "error") {
            const message = payload.message ?? dict.sttError;
            lastServerMessageRef.current = message;
            setError(message);
          }
        } catch {
          // Non-JSON messages are ignored; the server only sends error signals.
        }
      };
      // Route through `stop()`, not just `setIsStreaming(false)` — the socket can close
      // (e.g. on a failed handshake) while the recorder/mic stream are still open, which
      // would otherwise leave the microphone silently capturing with no way to release it
      // from the UI (the button reads "Start…" again, but a stale stream is still live).
      // A close the user didn't ask for (any code other than a normal 1000 closure) must
      // also be surfaced here, or the button just silently flips back to idle with no
      // indication of why. `classifyCaptionSocketClose` distinguishes three cases: a
      // trustworthy server-provided reason (server.ts's `ws.close(1011, reason)` — not
      // authorized, session not live, STT not configured, etc.), an "opaque" closure that
      // never reached `OPEN` and carries no reason (a VPN/proxy/firewall breaking the WS
      // Upgrade before it reaches the server — the same generic message for every one of
      // those cases used to be indistinguishable from a real server rejection), and a
      // "dropped" connection that opened and streamed before failing.
      socket.onclose = (event) => {
        console.log("[captions] SOCKET CLOSED", {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
        stoppedByUser: stoppedByUserRef.current,
        hasOpened: hasOpenedRef.current,
        readyState: socket.readyState,
        ...diagRef.current(),
      });
        // A stale socket's close must never touch shared state. `stop()` acts on
        // `socketRef`/`recorderRef`/`streamRef`, which by the time an *older* socket closes
        // already belong to a NEWER one — so without this guard, handling the old socket's
        // close tears down the new socket and its `MediaRecorder`. That was observed in
        // production as a livelock: server.ts evicts A in favour of B (`superseding an older
        // caption stream …`), A's close then kills B, a remount opens C, B's close kills C,
        // and so on. Captions never survive a cycle — no error is shown (an eviction is
        // silent by design), no "captions active" indicator, and no audio ever reaches STT.
        if (socketRef.current !== socket) return;
        if (stoppedByUserRef.current || event.code === CAPTION_SOCKET_NORMAL_CLOSURE_CODE) {
          stop();
          return;
        }
        const recovery = decideCaptionSocketReconnect({
          event,
          hasOpened: hasOpenedRef.current,
          attempts: reconnectAttemptsRef.current,
          shouldCapture: shouldCaptureRef.current,
        });
        console.log("[captions] recovery", recovery);
        if (recovery.kind === "reconnect") {
          reconnectAttemptsRef.current += 1;
          // `stop()` first (it clears any previously scheduled retry), then schedule —
          // ordering matters, since `stop()` would otherwise cancel the timer set here.
          stop();
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            startRef.current();
          }, recovery.delayMs);
          return;
        }

        if (recovery.kind === "surface") {
          // `event.reason` is capped at 123 bytes (the WebSocket close-frame limit —
          // see captions-socket.ts's closeWithReason) and can be a mid-sentence
          // truncation of the fuller message `onmessage` already set moments earlier
          // for the same connection (the server sends the full text as a data frame
          // before closing) — prefer that when it's there. Falls back to the
          // (possibly truncated) `event.reason` for a close with no preceding data
          // frame, e.g. "Not authorized"/"session not live" from server.ts's
          // pre-handshake rejections, which never went through onmessage at all.
          setError(
            recovery.failure.kind === "server-reason"
              ? (lastServerMessageRef.current ?? recovery.failure.reason)
              : recovery.failure.kind === "opaque"
                ? dict.connectionBlocked
                : dict.connectionFailed,
          );
        }
        // `recovery.kind === "superseded"` falls through to here: a newer socket for this
        // speaker already owns the stream, so tear this one down with no error shown.
        stop();
      };

      const stream = await acquireMicStream();
      // Which of the two capture paths ran, and how long it took, is the other thing the
      // current logs can't show — a `getUserMedia` fallback here means the clone fix isn't
      // actually engaging, which reintroduces the dual-capture republish loop.
      console.log("[captions] MIC ACQUIRED", {
        ...diagRef.current(),
        tracks: stream.getTracks().map((t) => ({ id: t.id.slice(0, 8), readyState: t.readyState, muted: t.muted, enabled: t.enabled })),
      });
      // The WebSocket can already have failed and closed (running `stop()` via `onclose`
      // above) while `getUserMedia`'s permission prompt was still pending — resolving
      // after that must not resurrect a "streaming" state or leave the mic hot with
      // nothing consuming it.
      const socketFailed =
        socketRef.current !== socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING;
      if (socketFailed) {
        stream.getTracks().forEach((track) => track.stop());
        // socketRef.current has already moved on (e.g. a re-entrant start()) —
        // this exact `socket` reference is otherwise unreachable from here on,
        // so it must close itself or it (and its server-side STT session)
        // leaks for the rest of the page's lifetime.
        if (socketRef.current !== socket) socket.close();
        return;
      }
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size === 0 || socket.readyState !== WebSocket.OPEN) {
          console.log("[captions] CHUNK DROPPED", { size: event.data.size, readyState: socket.readyState, ...diagRef.current() });
          return;
        }
        chunksSentRef.current += 1;
        bytesSentRef.current += event.data.size;
        // Only the first and then every 20th (~5s) — enough to prove audio is flowing without
        // drowning the console at 4 chunks/second.
        if (chunksSentRef.current === 1 || chunksSentRef.current % 20 === 0) {
          console.log("[captions] CHUNK SENT", diagRef.current());
        }
        // A small JSON text frame alongside each binary audio chunk — captions-socket.ts
        // branches on the WebSocket frame's own binary/text flag to tell these apart, so
        // this must go out as its own `send()` call, not merged into the audio buffer.
        socket.send(JSON.stringify({ type: "connection-quality", quality: qualityRef.current }));
        void event.data.arrayBuffer().then((buffer) => socket.send(buffer));
      };
      recorder.onerror = (e) => {
        console.log("[captions] recorder error", e);
        setError(dict.micRecordingFailed);
        stop();
      };

      recorder.start(CHUNK_INTERVAL_MS);
      console.log("[captions] RECORDER STARTED", { mimeType: recorder.mimeType, state: recorder.state, ...diagRef.current() });
      setIsStreaming(true);
    } catch (err) {
      console.log("[captions] START FAILED", err);
      setError(dict.micDenied);
      stop();
    } finally {
        startingRef.current = false;
        setIsConnecting(false);
    }
  }, [sessionId, stop, acquireMicStream, dict.connectionFailed, dict.connectionBlocked, dict.sttError, dict.micRecordingFailed, dict.micDenied]);

  // Keeps the indirection `onclose` reconnects through pointing at the current `start`.
  useEffect(() => {
    startRef.current = start;
  }, [start]);

  // The single trigger for this whole component: unmuting is already the one action
  // every participant takes to be heard at all, so tying capture to it directly means
  // there's nothing separate to click or forget. Skipped entirely while the server-side
  // agent already covers this identity (`agentCapturing`) to avoid duplicating captions.
  useEffect(() => {
  console.log("[captions] mic effect", {
    mic: isMicrophoneEnabled,
    agentCapturing,
    active: activeRef.current,
  });

  if (agentCapturing) return;

  if (isMicrophoneEnabled) {
    if (!activeRef.current) void start();
  } else if (activeRef.current) {
    stop();
  }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMicrophoneEnabled, agentCapturing]);

  if (agentCapturing) {
    return (
      <div className="flex items-center gap-2">
        <span
          className="font-data shrink-0 rounded-md border px-4 py-2 text-xs font-medium uppercase tracking-wider"
          style={{ color: "var(--tick-high)", borderColor: "var(--tick-high)" }}
          role="status"
        >
          {dict.agentCapturing}
        </span>
      </div>
    );
  }

  if (!isMicrophoneEnabled) return null;

  return (
    <div className="flex items-center gap-2">
      {isStreaming && (
        <span
          className="font-data shrink-0 rounded-md border px-4 py-2 text-xs font-medium uppercase tracking-wider"
          style={{ color: "var(--tick-high)", borderColor: "var(--tick-high)" }}
          role="status"
        >
          {dict.streaming}
        </span>
      )}
      {error && (
        <>
          <p className="text-xs" role="alert" style={{ color: "var(--tick-low)" }}>
            {error}
          </p>
          {/* Mic is still on (the `!isMicrophoneEnabled` early return above already
              covers the "mic off" case) but the socket itself failed — offer a manual
              retry rather than silently staying disconnected until the mic is
              toggled off and back on again. */}
          <button
            type="button"
            onClick={() => {
              // A deliberate user retry earns a fresh backoff ladder — without this, a
              // session that already exhausted its automatic attempts would get exactly
              // one more try per click forever after, with no self-healing in between.
              reconnectAttemptsRef.current = 0;
              void start();
            }}
            disabled={isConnecting}
            className="font-data shrink-0 rounded-md border border-border-strong px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-foreground disabled:opacity-50"
          >
            {dict.retry}
          </button>
        </>
      )}
    </div>
  );
}
