"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const CHUNK_INTERVAL_MS = 250;

/**
 * Streams facilitator mic audio to `/api/captions/stream` over a WebSocket —
 * true streaming STT (Deepgram's live API), replacing the earlier
 * chunked-REST approach. Short `MediaRecorder` timeslices keep frames small
 * enough for near-real-time transcription; the server persists and
 * DataChannel-pushes each final transcript as it arrives.
 */
export function LiveCaptionStream({ sessionId }: { sessionId: string }) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const stop = useCallback(() => {
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
    try {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${window.location.host}/api/captions/stream?sessionId=${sessionId}`);
      socketRef.current = socket;
      socket.onerror = () => setError("Live caption connection failed.");
      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as { type?: string; message?: string };
          if (payload.type === "error") setError(payload.message ?? "Speech-to-text error.");
        } catch {
          // Non-JSON messages are ignored; the server only sends error signals.
        }
      };
      socket.onclose = () => setIsStreaming(false);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size === 0 || socket.readyState !== WebSocket.OPEN) return;
        void event.data.arrayBuffer().then((buffer) => socket.send(buffer));
      };
      recorder.onerror = () => setError("Microphone recording failed.");

      recorder.start(CHUNK_INTERVAL_MS);
      setIsStreaming(true);
    } catch {
      setError("Microphone access was denied or unavailable.");
    }
  }, [sessionId]);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => (isStreaming ? stop() : void start())}
        className="font-data shrink-0 rounded-md border border-border-strong px-4 py-2 text-xs font-medium uppercase tracking-wider text-foreground"
        style={isStreaming ? { color: "var(--tick-high)", borderColor: "var(--tick-high)" } : undefined}
        aria-pressed={isStreaming}
      >
        {isStreaming ? "Stop live captions" : "Start live captions from mic"}
      </button>
      {error && (
        <p className="text-xs" role="alert" style={{ color: "var(--tick-low)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
