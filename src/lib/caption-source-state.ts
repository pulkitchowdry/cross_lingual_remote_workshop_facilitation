import { prisma } from "@/lib/db";

/**
 * Tracks which sessions the server-side caption agent (`caption-agent.ts`) is
 * actively streaming facilitator audio for, so the facilitator dashboard can
 * decide whether to still offer the browser-driven `LiveCaptionStream`
 * WebSocket path.
 *
 * Backed by `Session.captionAgentActive` in Postgres, not in-process memory —
 * an in-memory `Set` here was silently always empty on the read side: the
 * LiveKit Agents worker that calls `markCaptionAgentCapturing` runs inside a
 * per-job forked OS process (`@livekit/agents`' `JobProcExecutor`, see
 * server.ts's `startCaptionAgent` comment), a different process, with its own
 * module registry, from the one serving the facilitator dashboard that calls
 * `isCaptionAgentCapturing` — a `Set` mutated in one is invisible in the
 * other. The database is the one thing both processes actually share.
 *
 * Failures here are logged but never thrown — `caption-agent.ts` streams
 * live audio to Deepgram regardless of whether the dashboard's "already
 * capturing" indicator updates correctly, so a transient DB error must not
 * interrupt that.
 */
export async function markCaptionAgentCapturing(sessionId: string): Promise<void> {
  try {
    await prisma.session.update({ where: { id: sessionId }, data: { captionAgentActive: true } });
  } catch (error) {
    console.error(`[caption-source-state] failed to mark session ${sessionId} as capturing:`, error);
  }
}

export async function clearCaptionAgentCapturing(sessionId: string): Promise<void> {
  try {
    await prisma.session.update({ where: { id: sessionId }, data: { captionAgentActive: false } });
  } catch (error) {
    console.error(`[caption-source-state] failed to clear session ${sessionId} as capturing:`, error);
  }
}
