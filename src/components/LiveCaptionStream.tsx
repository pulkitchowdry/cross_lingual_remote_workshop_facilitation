"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getDictionary } from "@/lib/i18n";
import type { SupportedLanguage } from "@/lib/session-contracts";

const CHUNK_INTERVAL_MS = 250;
const NORMAL_CLOSURE_CODE = 1000;

/**
 * Streams facilitator mic audio to `/api/captions/stream` over a WebSocket —
 * true streaming STT (Deepgram's live API), replacing the earlier
 * chunked-REST approach. Short `MediaRecorder` timeslices keep frames small
 * enough for near-real-time transcription; the server persists and
 * DataChannel-pushes each final transcript as it arrives.
 */
export function LiveCaptionStream({ sessionId, lang }: { sessionId: string; lang: SupportedLanguage }) {
  const dict = getDictionary(lang).captions;
  const [isStreaming, setIsStreaming] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const stoppedByUserRef = useRef(false);

  const stop = useCallback(() => {
    stoppedByUserRef.current = true;
    recorderRef.current?.stop();
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    socketRef.current?.close();
    socketRef.current = null;
    setIsStreaming(false);
  }, []);

  useEffect(() => stop, [stop]);

  const start = useCallback(async () => {
    setError(null);
    stoppedByUserRef.current = false;
    setIsConnecting(true);
    try {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${window.location.host}/api/captions/stream?sessionId=${sessionId}`);
      socketRef.current = socket;
      socket.onerror = () => setError(dict.connectionFailed);
      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as { type?: string; message?: string };
          if (payload.type === "error") setError(payload.message ?? dict.sttError);
        } catch {
          // Non-JSON messages are ignored; the server only sends error signals.
        }
      };
      // Route through `stop()`, not just `setIsStreaming(false)` — the socket can close
      // (e.g. on a failed handshake) while the recorder/mic stream are still open, which
      // would otherwise leave the microphone silently capturing with no way to release it
      // from the UI (the button reads "Start…" again, but a stale stream is still live).
      // A close the user didn't ask for (any code other than a normal 1000 closure — e.g.
      // the server's `ws.close(1011, ...)` when the route handler throws *after* a
      // successful production handshake, which never reaches `onerror`/a `{type:'error'}`
      // message) must also be surfaced here, or the button just silently flips back to idle.
      socket.onclose = (event) => {
        if (!stoppedByUserRef.current && event.code !== NORMAL_CLOSURE_CODE) {
          setError(dict.connectionFailed);
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
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size === 0 || socket.readyState !== WebSocket.OPEN) return;
        void event.data.arrayBuffer().then((buffer) => socket.send(buffer));
      };
      recorder.onerror = () => {
        setError(dict.micRecordingFailed);
        stop();
      };

      recorder.start(CHUNK_INTERVAL_MS);
      setIsStreaming(true);
    } catch {
      setError(dict.micDenied);
      stop();
    } finally {
      setIsConnecting(false);
    }
  }, [sessionId, stop, dict.connectionFailed, dict.sttError, dict.micRecordingFailed, dict.micDenied]);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => (isStreaming ? stop() : void start())}
        disabled={isConnecting}
        className="font-data shrink-0 rounded-md border border-border-strong px-4 py-2 text-xs font-medium uppercase tracking-wider text-foreground disabled:opacity-50"
        style={isStreaming ? { color: "var(--tick-high)", borderColor: "var(--tick-high)" } : undefined}
        aria-pressed={isStreaming}
      >
        {isStreaming ? dict.stop : dict.start}
      </button>
      {error && (
        <p className="text-xs" role="alert" style={{ color: "var(--tick-low)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
