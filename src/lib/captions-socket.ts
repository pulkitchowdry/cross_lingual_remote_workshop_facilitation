import type { WebSocket } from "ws";
import { prisma } from "@/lib/db";
import { SessionStatus, type Session } from "@/generated/prisma/client";
import { publishTranslatedCaption } from "@/lib/captions";
import { speechToTextProvider, type SpeechToTextStream } from "@/lib/providers/speech-to-text";
import type { SupportedLanguage } from "@/lib/session-contracts";
import { captionLatencyNowMs } from "@/lib/caption-latency-log";

/**
 * Wires a raw WebSocket (already upgraded and authorized — see `server.ts`)
 * to the STT stream for a live session. Shared so the socket-handling logic
 * lives in one place regardless of how the upgrade itself happened.
 */
/** How often to re-check whether the caption-agent worker has started capturing this
 * same facilitator's mic elsewhere — see the `duplicateGuardInterval` comment below. */
const DUPLICATE_CAPTURE_CHECK_MS = 3_000;

/** RFC 6455 caps a close frame's reason at 123 bytes. `ws`'s own `close()`
 * doesn't truncate — it throws a synchronous `RangeError` past that limit
 * (`node_modules/ws/lib/sender.js`'s `close()`), uncaught, which crashes the
 * whole Node process, not just this one connection (this fires from deep
 * inside a raw socket's own event dispatch, nowhere any of this app's own
 * try/catch reaches). A short, hand-written literal (e.g. "Not authorized
 * for this session.") is always safe, but a *dynamic* reason built from an
 * upstream error — this file's own `onError` echoing Deepgram's close
 * reason, or `server.ts`'s catch-all forwarding whatever an unexpected
 * exception's `.message` happens to be — can exceed it, especially once
 * wrapped in this app's own descriptive prefix. Route every dynamic reason
 * through this instead of calling `ws.close()` directly.
 */
export function closeWithReason(ws: WebSocket, code: number, reason: string): void {
  let safeReason = reason;
  while (Buffer.byteLength(safeReason, "utf8") > 123) {
    safeReason = safeReason.slice(0, -1);
  }
  ws.close(code, safeReason);
}

export function attachCaptionSocket(ws: WebSocket, session: Session) {
  const sourceLanguage = session.sourceLanguage as SupportedLanguage;
  let segmentStartedAt = new Date();
  let firstAudioSubmittedAtMs: number | undefined;

  // server.ts's upgrade handler only checks `captionAgentActive` once, at handshake
  // time. If the LiveKit caption-agent worker starts capturing this same
  // facilitator's mic while this browser-mic socket is already open (a real race:
  // click "Start" here, then unmute the ControlBar mic moments later), both
  // pipelines run and duplicate every caption until the *client's own* ~2s poll
  // notices `captionAgentActive` flipped true and stops itself
  // (LiveCaptionStream.tsx) — a window that can stretch further if the tab is
  // backgrounded and its interval gets throttled. Re-checking here closes the
  // redundant stream promptly and authoritatively from the server side too,
  // instead of relying solely on that client-side polling.
  const duplicateGuardInterval = setInterval(() => {
    void prisma.session
      .findUnique({ where: { id: session.id }, select: { captionAgentActive: true } })
      .then((current) => {
        if (current?.captionAgentActive) {
          closeWithReason(ws, 1011, "Captions are already being captured automatically for this session.");
        }
      })
      .catch((error) => console.error(`[captions/stream] duplicate-capture check failed for ${session.id}:`, error));
  }, DUPLICATE_CAPTURE_CHECK_MS);

  // openStream() can throw synchronously (e.g. a strict-privacy session with no
  // local-inference tier configured — see its own "cloud fallback is disabled"
  // check) before the ws.on("close"/"error") handlers below ever get registered,
  // so without this try/catch the interval above would never get cleared.
  let sttStream: SpeechToTextStream;
  try {
    sttStream = speechToTextProvider.openStream!({
      expectedLanguage: sourceLanguage,
      allowCloudFallback: session.translationMode !== "LOCAL_ONLY",
      onSegment: (event) => {
        if (!event.isFinal) return;
        // Capture and advance the timestamp synchronously, in the same tick the
        // event arrives — not after the async publish below resolves. Two `is_final`
        // events close together would otherwise both read the same stale
        // `segmentStartedAt`, since the previous reassignment hadn't run yet.
        const startedAt = segmentStartedAt;
        const endedAt = new Date();
        const originalCaptionReadyAtMs = captionLatencyNowMs();
        const audioSubmittedAtMs = firstAudioSubmittedAtMs;
        segmentStartedAt = endedAt;
        firstAudioSubmittedAtMs = undefined;
        void (async () => {
          // Re-fetch the full session per segment, not just once at connect — the
          // facilitator may click "End session" while this socket is still open, or
          // change the session's source language mid-LIVE-session (updateFacilitatorLanguage
          // has no LIVE-session guard). Re-fetching only `status` and still publishing
          // against the stale `session`/`sourceLanguage` closed over at connect time
          // (mirrors the per-segment re-fetch in src/lib/caption-agent.ts, which reads
          // the *fresh* session for exactly this reason) meant every segment kept
          // getting stamped and translated with whatever language was active when this
          // WebSocket first opened, for the rest of its lifetime.
          const current = await prisma.session.findUnique({ where: { id: session.id } });
          if (!current || current.status !== SessionStatus.LIVE) return;
          await publishTranslatedCaption(current, {
            speakerId: null,
            originalText: event.text,
            language: current.sourceLanguage as SupportedLanguage,
            startedAt,
            endedAt,
            instrumentation: {
              source: "browser-ws",
              audioSubmittedAtMs,
              originalCaptionReadyAtMs,
            },
          });
        })().catch((error) => console.error(`[captions/stream] failed to publish a segment for ${session.id}:`, error));
      },
      onError: (error) => {
        // Send the error, then close — without closing, the STT stream is dead (its
        // `sendAudio` silently no-ops once the inner connection leaves OPEN) but the
        // WebSocket itself stays open, so the client (LiveCaptionStream.tsx) never
        // gets an `onclose` and keeps rendering an active "Stop"/recording state
        // indefinitely while no further audio is actually being transcribed.
        ws.send(JSON.stringify({ type: "error", message: error.message }));
        closeWithReason(ws, 1011, error.message);
      },
    });
  } catch (error) {
    clearInterval(duplicateGuardInterval);
    throw error;
  }

  ws.on("message", (data) => {
    firstAudioSubmittedAtMs ??= captionLatencyNowMs();
    sttStream.sendAudio(new Uint8Array(data as Buffer));
  });
  ws.on("close", () => {
    clearInterval(duplicateGuardInterval);
    sttStream.close();
  });
  ws.on("error", () => {
    clearInterval(duplicateGuardInterval);
    sttStream.close();
  });
}
