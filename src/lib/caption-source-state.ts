/**
 * Tracks which sessions the server-side caption agent (`caption-agent.ts`) is
 * actively streaming facilitator audio for, so the facilitator dashboard can
 * decide whether to still offer the browser-driven `LiveCaptionStream`
 * WebSocket path. Split into its own module (rather than exporting from
 * `caption-agent.ts` directly) so a Server Component can read this state
 * without pulling `@livekit/agents`/`@livekit/rtc-node` into its bundle.
 *
 * In-memory only — correct as long as the app runs as a single Node process
 * (see `docs/DEPLOYMENT.md`; the caption agent is registered in-process from
 * `server.ts`, not run as a separate worker). A multi-instance deployment
 * would need this shared through the database or a pub/sub channel instead.
 */
const capturingSessionIds = new Set<string>();

export function markCaptionAgentCapturing(sessionId: string): void {
  capturingSessionIds.add(sessionId);
}

export function clearCaptionAgentCapturing(sessionId: string): void {
  capturingSessionIds.delete(sessionId);
}

export function isCaptionAgentCapturing(sessionId: string): boolean {
  return capturingSessionIds.has(sessionId);
}
