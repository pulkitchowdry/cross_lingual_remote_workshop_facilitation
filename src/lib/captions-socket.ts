import type { WebSocket } from "ws";
import { prisma } from "@/lib/db";
import { SessionStatus, type Session } from "@/generated/prisma/client";
import { publishTranslatedCaption } from "@/lib/captions";
import { speechToTextProvider } from "@/lib/providers/speech-to-text";
import type { SupportedLanguage } from "@/lib/session-contracts";

/**
 * Wires a raw WebSocket (already upgraded and authorized — see `server.ts`)
 * to the STT stream for a live session. Shared so the socket-handling logic
 * lives in one place regardless of how the upgrade itself happened.
 */
export function attachCaptionSocket(ws: WebSocket, session: Session) {
  const sourceLanguage = session.sourceLanguage as SupportedLanguage;
  let segmentStartedAt = new Date();

  const sttStream = speechToTextProvider.openStream!({
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
      segmentStartedAt = endedAt;
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
          speakerId: "Facilitator",
          originalText: event.text,
          language: current.sourceLanguage as SupportedLanguage,
          startedAt,
          endedAt,
        });
      })();
    },
    onError: (error) => {
      // Send the error, then close — without closing, the STT stream is dead (its
      // `sendAudio` silently no-ops once the inner connection leaves OPEN) but the
      // WebSocket itself stays open, so the client (LiveCaptionStream.tsx) never
      // gets an `onclose` and keeps rendering an active "Stop"/recording state
      // indefinitely while no further audio is actually being transcribed.
      ws.send(JSON.stringify({ type: "error", message: error.message }));
      ws.close(1011, error.message);
    },
  });

  ws.on("message", (data) => {
    sttStream.sendAudio(new Uint8Array(data as Buffer));
  });
  ws.on("close", () => sttStream.close());
  ws.on("error", () => sttStream.close());
}
