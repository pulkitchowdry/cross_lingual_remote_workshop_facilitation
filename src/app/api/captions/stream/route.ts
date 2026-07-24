import { experimental_upgradeWebSocket } from "@vercel/functions";
import { NextRequest } from "next/server";
import { SessionStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { hasFacilitatorAccess } from "@/lib/session-access";
import { publishTranslatedCaption } from "@/lib/captions";
import { speechToTextProvider } from "@/lib/providers/speech-to-text";
import type { SupportedLanguage } from "@/lib/session-contracts";

/**
 * Live-caption WebSocket endpoint — Part 2 of `docs/TRANSLATION_ARCHITECTURE.md`.
 * The facilitator's browser streams raw mic audio frames over this socket;
 * each frame is forwarded to `speechToTextProvider.openStream`, and every
 * final transcript is translated and persisted via `publishTranslatedCaption`
 * (the same path typed captions use), which also pushes the LiveKit
 * DataChannel signal so viewers refresh immediately.
 *
 * Auth happens on the plain HTTP GET *before* the upgrade — `ws` callback
 * only exposes the raw socket, not the original request.
 */
export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return Response.json({ error: "sessionId is required." }, { status: 400 });
  }
  if (!(await hasFacilitatorAccess(sessionId))) {
    return Response.json({ error: "Not authorized for this session." }, { status: 403 });
  }
  if (!speechToTextProvider.isConfigured || !speechToTextProvider.openStream) {
    return Response.json({ error: "Streaming speech-to-text is not configured: set STT_API_KEY." }, { status: 503 });
  }

  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session || session.status !== SessionStatus.LIVE) {
    return Response.json({ error: "Start the session before streaming captions." }, { status: 409 });
  }

  const sourceLanguage = session.sourceLanguage as SupportedLanguage;

  try {
    return await experimental_upgradeWebSocket((ws) => {
      let segmentStartedAt = new Date();

      const sttStream = speechToTextProvider.openStream!({
        expectedLanguage: sourceLanguage,
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
            // Re-check status per segment, not just once at connect — the facilitator
            // may click "End session" while this socket is still open (mirrors the
            // per-call re-check in /api/captions/agent's POST handler).
            const current = await prisma.session.findUnique({
              where: { id: session.id },
              select: { status: true },
            });
            if (!current || current.status !== SessionStatus.LIVE) return;
            await publishTranslatedCaption(session, {
              speakerId: "Facilitator",
              originalText: event.text,
              language: sourceLanguage,
              startedAt,
              endedAt,
            });
          })();
        },
        onError: (error) => {
          ws.send(JSON.stringify({ type: "error", message: error.message }));
        },
      });

      ws.on("message", (data) => {
        sttStream.sendAudio(new Uint8Array(data as Buffer));
      });
      ws.on("close", () => sttStream.close());
      ws.on("error", () => sttStream.close());
    });
  } catch {
    // `experimental_upgradeWebSocket` throws when the current runtime has no WebSocket
    // upgrade support (e.g. plain `next dev` — only actual Vercel Fluid Compute, or
    // `vercel dev`, populates the request context it needs). Fail as a clean HTTP
    // response instead of leaving the client's WebSocket handshake hanging.
    return Response.json(
      {
        error:
          "Live mic streaming isn't available in this environment. It requires a Vercel deployment (or `vercel dev`) — `next dev` alone can't upgrade this connection. Use the typed caption box instead.",
      },
      { status: 503 },
    );
  }
}
