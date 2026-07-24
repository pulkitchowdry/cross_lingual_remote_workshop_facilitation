"use client";

import { useCallback, useRef, useState } from "react";

const CHUNK_INTERVAL_MS = 5_000;

/**
 * Captures short mic audio chunks and hands each one to `transcribeAction`
 * (`transcribeAndPublishCaption` bound to a session) — Part 2 of
 * `docs/TRANSLATION_ARCHITECTURE.md`. Chunked `MediaRecorder` capture, not a
 * persistent stream, matches `SpeechToTextProvider.transcribeChunk`'s
 * per-chunk contract and needs no server-side LiveKit track subscription.
 */
export function LiveCaptionMic({ transcribeAction }: { transcribeAction: (formData: FormData) => Promise<void> }) {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setIsRecording(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size === 0) return;
        const formData = new FormData();
        formData.set("audio", event.data, "chunk.webm");
        void transcribeAction(formData).catch((transcribeError) => {
          setError(transcribeError instanceof Error ? transcribeError.message : "Transcription failed.");
        });
      };
      recorder.onerror = () => setError("Microphone recording failed.");

      recorder.start(CHUNK_INTERVAL_MS);
      setIsRecording(true);
    } catch {
      setError("Microphone access was denied or unavailable.");
    }
  }, [transcribeAction]);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => (isRecording ? stop() : void start())}
        className="font-data shrink-0 rounded-md border border-border-strong px-4 py-2 text-xs font-medium uppercase tracking-wider text-foreground"
        style={isRecording ? { color: "var(--tick-high)", borderColor: "var(--tick-high)" } : undefined}
        aria-pressed={isRecording}
      >
        {isRecording ? "Stop live captions" : "Start live captions from mic"}
      </button>
      {error && (
        <p className="text-xs" style={{ color: "var(--tick-low)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
