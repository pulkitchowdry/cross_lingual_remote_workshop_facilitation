"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalParticipant } from "@livekit/components-react";
import { CAPTION_SOCKET_NORMAL_CLOSURE_CODE, classifyCaptionSocketClose } from "@/lib/caption-socket-client";
import { getDictionary } from "@/lib/i18n";
import type { SupportedLanguage } from "@/lib/session-contracts";

const CHUNK_INTERVAL_MS = 250;

/**
 * Explicitly picks a `MediaRecorder` mimeType instead of leaving it to the
 * browser's own default, in priority order of what the server-side buffering
 * (`local-speech-buffer.ts`) and Deepgram's container auto-detect both know how
 * to handle. Chrome/Firefox/Edge support `audio/webm;codecs=opus`; Safari
 * supports neither WebM variant at all but does support `audio/mp4` (AAC) —
 * without requesting it explicitly, Safari's un-opinionated default has in the
 * past varied across versions, which the server has no way to detect after the
 * fact. Returns `undefined` (browser default, best-effort) only when
 * `MediaRecorder`/`isTypeSupported` themselves are unavailable or none of the
 * known-good candidates are supported.
 */
function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return undefined;
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

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
  const dict = getDictionary(lang).captions;
  const { isMicrophoneEnabled } = useLocalParticipant();
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
  // Monotonically increasing token identifying each start() attempt. The catch/onerror/
  // onclose handlers below capture their own attempt's value and compare it against the
  // live counter before tearing anything down — without this, a stale attempt's late
  // failure (e.g. getUserMedia's permission prompt resolving well after a newer attempt
  // has already taken over and is actively streaming) would call the shared `stop()` and
  // kill that newer, healthy session out from under it. Bumped by `stop()` too, so an
  // explicit stop (mic toggled off, unmount) also invalidates whatever attempt is still
  // in flight at that moment.
  const attemptTokenRef = useRef(0);
  /** Whether the current socket ever reached `OPEN` — see caption-socket-client.ts's "opaque" case. */
  const hasOpenedRef = useRef(false);
  // The full, untruncated error text from a server `{ type: "error", message }` data
  // frame (captions-socket.ts's onError sends this before closing) — the close frame
  // that follows immediately after carries the *same* message, but truncated to 123
  // bytes (WebSocket's close-reason limit; see captions-socket.ts's closeWithReason).
  // `onclose` below prefers this over the truncated `event.reason` when both exist for
  // the same connection, so a message cut off mid-sentence never clobbers the clear one.
  const lastServerMessageRef = useRef<string | null>(null);

  const stop = useCallback(() => {
    attemptTokenRef.current += 1;
    activeRef.current = false;
    stoppedByUserRef.current = true;
    hasOpenedRef.current = false;
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
    const attemptToken = ++attemptTokenRef.current;
    activeRef.current = true;
    setError(null);
    stoppedByUserRef.current = false;
    hasOpenedRef.current = false;
    lastServerMessageRef.current = null;
    setIsConnecting(true);
    try {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      // Chosen once per connection attempt and reused for both the URL (so the server
      // knows what container to expect — see captions-socket.ts/local-speech-buffer.ts)
      // and the MediaRecorder instantiation below, so the two can never disagree.
      const mimeType = pickRecorderMimeType();
      const mimeTypeParam = mimeType ? `&mimeType=${encodeURIComponent(mimeType)}` : "";
      const socket = new WebSocket(`${protocol}//${window.location.host}/api/captions/stream?sessionId=${sessionId}${mimeTypeParam}`);
      socketRef.current = socket;
      socket.onopen = () => {
        hasOpenedRef.current = true;
      };
      // `onclose` always fires right after and carries the actual signal (a
      // server-provided reason, or an abnormal closure) — nothing to add here.
      socket.onerror = () => {};
      socket.onmessage = (event) => {
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
        // A newer start() attempt has already superseded this one (see attemptTokenRef's
        // doc comment) — this socket is no longer the active one, so its close must not
        // touch the newer attempt's error state or tear down its live socket/recorder/stream.
        if (attemptTokenRef.current !== attemptToken) return;
        if (!stoppedByUserRef.current && event.code !== CAPTION_SOCKET_NORMAL_CLOSURE_CODE) {
          const failure = classifyCaptionSocketClose(event, hasOpenedRef.current);
          // `event.reason` is capped at 123 bytes (the WebSocket close-frame limit —
          // see captions-socket.ts's closeWithReason) and can be a mid-sentence
          // truncation of the fuller message `onmessage` already set moments earlier
          // for the same connection (the server sends the full text as a data frame
          // before closing) — prefer that when it's there. Falls back to the
          // (possibly truncated) `event.reason` for a close with no preceding data
          // frame, e.g. "Not authorized"/"session not live" from server.ts's
          // pre-handshake rejections, which never went through onmessage at all.
          setError(
            failure.kind === "server-reason"
              ? (lastServerMessageRef.current ?? failure.reason)
              : failure.kind === "opaque"
                ? dict.connectionBlocked
                : dict.connectionFailed,
          );
        }
        stop();
      };

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size === 0 || socket.readyState !== WebSocket.OPEN) return;
        void event.data.arrayBuffer().then((buffer) => socket.send(buffer));
      };
      recorder.onerror = () => {
        // Same staleness guard as socket.onclose above — a superseded attempt's recorder
        // failing late must not kill whatever newer attempt is now actually streaming.
        if (attemptTokenRef.current !== attemptToken) return;
        setError(dict.micRecordingFailed);
        stop();
      };

      recorder.start(CHUNK_INTERVAL_MS);
      setIsStreaming(true);
    } catch {
      // Same staleness guard — e.g. this attempt's own `getUserMedia` permission prompt
      // resolving (with a denial/error) well after a newer attempt has already taken over
      // and is actively recording; without this check, stop() here would tear down that
      // newer, healthy session instead of doing nothing for this superseded one.
      if (attemptTokenRef.current !== attemptToken) return;
      setError(dict.micDenied);
      stop();
    } finally {
      setIsConnecting(false);
    }
  }, [sessionId, stop, dict.connectionFailed, dict.connectionBlocked, dict.sttError, dict.micRecordingFailed, dict.micDenied]);

  // The single trigger for this whole component: unmuting is already the one action
  // every participant takes to be heard at all, so tying capture to it directly means
  // there's nothing separate to click or forget. Skipped entirely while the server-side
  // agent already covers this identity (`agentCapturing`) to avoid duplicating captions.
  useEffect(() => {
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
        {/* No `shrink-0` here (unlike the `isStreaming` badge below) — that badge's
            short fixed copy never needs to give up space to a sibling in its row, but
            this one's full-sentence copy is wider than the sidebar itself; forcing it
            to hold its intrinsic width instead of shrinking/wrapping pushed the tail
            of the sentence off the edge of the panel with nothing to scroll to it. */}
        <span
          className="font-data animate-fade-in min-w-0 rounded-md border px-4 py-2 text-xs font-medium uppercase tracking-wider whitespace-normal"
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
          className="font-data animate-fade-in shrink-0 rounded-md border px-4 py-2 text-xs font-medium uppercase tracking-wider"
          style={{ color: "var(--tick-high)", borderColor: "var(--tick-high)" }}
          role="status"
        >
          {dict.streaming}
        </span>
      )}
      {error && (
        <>
          <p className="animate-fade-in text-xs" role="alert" style={{ color: "var(--tick-low)" }}>
            {error}
          </p>
          {/* Mic is still on (the `!isMicrophoneEnabled` early return above already
              covers the "mic off" case) but the socket itself failed — offer a manual
              retry rather than silently staying disconnected until the mic is
              toggled off and back on again. */}
          <button
            type="button"
            onClick={() => void start()}
            disabled={isConnecting}
            className="font-data press-scale shrink-0 rounded-md border border-border-strong px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-foreground transition-colors disabled:opacity-50"
          >
            {dict.retry}
          </button>
        </>
      )}
    </div>
  );
}
