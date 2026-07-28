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

/**
 * Per-learner equivalent of `markCaptionAgentCapturing`/`clearCaptionAgentCapturing`,
 * backed by `SessionParticipant.agentCapturing` rather than the session-wide
 * `captionAgentActive` — more than one learner can be in a room at once, so a single
 * per-session boolean can't say *which* learner the agent is currently capturing. Same
 * cross-process reasoning applies: `caption-agent.ts` calls these from its own forked
 * job process, and `LiveCaptionStream.tsx`'s server-rendered `agentCapturing` prop (and
 * `server.ts`/`captions-socket.ts`'s own duplicate-guard checks) read the result from the
 * main process, so only the database bridges the two.
 */
export async function markLearnerCaptionAgentCapturing(participantId: string): Promise<void> {
  try {
    await prisma.sessionParticipant.update({ where: { id: participantId }, data: { agentCapturing: true } });
  } catch (error) {
    console.error(`[caption-source-state] failed to mark participant ${participantId} as capturing:`, error);
  }
}

export async function clearLearnerCaptionAgentCapturing(participantId: string): Promise<void> {
  try {
    await prisma.sessionParticipant.update({ where: { id: participantId }, data: { agentCapturing: false } });
  } catch (error) {
    console.error(`[caption-source-state] failed to clear participant ${participantId} as capturing:`, error);
  }
}
