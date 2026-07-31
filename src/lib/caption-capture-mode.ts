/**
 * Which of the two mic-capture pipelines is allowed to run, as a single switch.
 *
 * There are two ways a participant's speech reaches STT, and they have never had a
 * trustworthy de-duplication mechanism between them:
 *
 *  - **agent** — `caption-agent.ts`, a LiveKit Agents worker that subscribes to a
 *    participant's published track server-side. Audio never touches this app's own
 *    HTTP surface; it arrives over the participant's existing LiveKit Cloud connection.
 *  - **browser** — `LiveCaptionStream.tsx` → `/api/captions/stream`, a WebSocket this
 *    app serves itself, carrying `MediaRecorder` chunks from the participant's browser.
 *
 * Running both for one speaker duplicates every caption line (issue #95, and
 * `CAPTION_AUDIO_TROUBLESHOOTING.md` §1). The historical fix was to split them by role —
 * agent for the facilitator, browser for learners — which meant *both* had to work for
 * the product to work, and left the only de-dup state (`Session.captionAgentActive`)
 * facilitator-scoped and unable to say anything about a learner.
 *
 * That split is what made the Railway outage asymmetric: with the browser WebSocket
 * failing 100% of the time there (§9's `age=2ms` reset), facilitator→learner captions
 * worked — the agent carried them — while learner→facilitator had no path at all. One
 * broken transport took out exactly half the product.
 *
 * Selecting a mode instead of splitting by role means a single, uniform path per
 * deployment, so duplicates are impossible by construction rather than by guard, and a
 * transport that is broken in one environment can be routed around without a code change.
 */
export type CaptionCaptureMode =
  /**
   * Agent captures **everyone**; the browser WebSocket is disabled for all roles. Use
   * where the browser WS is unreliable but LiveKit is reachable — i.e. Railway today.
   */
  | "agent-all"
  /**
   * Agent captures the facilitator only; learners use the browser WebSocket. The
   * historical behavior, and the default so nothing changes without opting in.
   */
  | "agent-facilitator"
  /**
   * Agent is never started; the browser WebSocket carries everyone, facilitator
   * included. Use where the worker can't reach LiveKit (the documented Railway IPv6
   * `ENETUNREACH`), or to take the worker out of the web server's CPU budget entirely.
   */
  | "browser-only";

/**
 * Explicit agent name for `caption-agent.ts`'s LiveKit Agents worker (`server.ts`'s
 * `ServerOptions.agentName` and `RoomProvider.issueCredential`'s `RoomConfiguration.agents`
 * both need this exact string to agree, so it lives here rather than duplicated in each).
 * LiveKit's own docs advise against unnamed/automatic dispatch ("dispatches an agent to
 * every new room... not recommended for most applications") in favor of naming the agent
 * and requesting it explicitly per room — the token-embedded `RoomConfiguration.agents`
 * approach fires reliably at the moment a room is first created (including a room this
 * app creates only implicitly, via a participant's token, never via an explicit
 * `createRoom()` call) and is silently ignored on every later reconnect token once the
 * room already exists.
 */
export const CAPTION_AGENT_NAME = "caption-agent";

const DEFAULT_MODE: CaptionCaptureMode = "agent-facilitator";

const VALID_MODES: readonly CaptionCaptureMode[] = ["agent-all", "agent-facilitator", "browser-only"];

/** Values already warned about, so an invalid mode doesn't log on every render, every socket
 * authorization, and every published caption segment (`resolveSpeakerContext` runs per segment). */
const warnedValues = new Set<string>();

/**
 * Read from `process.env` on every call rather than cached at module load: this module is
 * imported both by the web process and by the forked LiveKit Agents job subprocess, and
 * a cached value read at import time in one of those is invisible to the other.
 * A misspelled value falls back to the default with a warning rather than throwing —
 * a typo in an env var should not take down a live session's captions entirely.
 */
export function captionCaptureMode(): CaptionCaptureMode {
  const raw = process.env.CAPTION_CAPTURE_MODE?.trim();
  if (!raw) return DEFAULT_MODE;
  if ((VALID_MODES as readonly string[]).includes(raw)) return raw as CaptionCaptureMode;
  if (!warnedValues.has(raw)) {
    warnedValues.add(raw);
    console.warn(`[captions] CAPTION_CAPTURE_MODE="${raw}" is not one of ${VALID_MODES.join(" | ")}; falling back to "${DEFAULT_MODE}".`);
  }
  return DEFAULT_MODE;
}

/** Whether the LiveKit Agents worker should be started at all (`server.ts`). */
export function agentCaptureEnabled(mode: CaptionCaptureMode = captionCaptureMode()): boolean {
  return mode !== "browser-only";
}

/** Whether the LiveKit worker should subscribe to this role's published track. */
export function agentCaptures(role: "facilitator" | "learner", mode: CaptionCaptureMode = captionCaptureMode()): boolean {
  if (mode === "browser-only") return false;
  if (mode === "agent-all") return true;
  return role === "facilitator";
}

/**
 * Whether the browser WebSocket is **forbidden** for this role — deliberately NOT just
 * `!agentCaptures(role)`.
 *
 * Under `agent-facilitator` the agent is the facilitator's *primary* path and the browser
 * stream is its *fallback*, which is what has always made the facilitator resilient to the
 * worker not being there: no credentials, the documented Railway IPv6 `ENETUNREACH`, LiveKit's
 * CPU-based `load_fnc` refusing the job, or a dispatch that simply never lands. In all of
 * those `captionAgentActive` stays false and the browser path picks up the slack. Treating
 * "the agent is assigned this role" as "the browser must refuse it" would delete that
 * fallback and leave the facilitator with NO capture path while the UI claimed captions were
 * already running — trading a ≤3s duplicate window (already bounded by `captionAgentActive`
 * plus `captions-socket.ts`'s duplicate-guard interval) for a permanent silent failure.
 *
 * So only `agent-all` — where the browser transport is being routed around on purpose and
 * there is no fallback worth preserving — forbids it. Everywhere else the runtime
 * `captionAgentActive` signal remains the arbiter, exactly as before.
 */
export function browserCaptureDisabled(role: "facilitator" | "learner", mode: CaptionCaptureMode = captionCaptureMode()): boolean {
  return mode === "agent-all" && agentCaptures(role, mode);
}
