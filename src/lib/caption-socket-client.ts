export const CAPTION_SOCKET_NORMAL_CLOSURE_CODE = 1000;

export type CaptionSocketFailure =
  /** The server completed the handshake and closed with a reason (`server.ts`'s upgrade handler) — trustworthy and specific (e.g. "Not authorized", "session not live"). */
  | { kind: "server-reason"; reason: string }
  /**
   * The socket never reached `OPEN` and closed with no reason (browsers zero
   * out `code`/`reason` to an abnormal closure whenever the underlying
   * connection drops before a server-acknowledged close — see MDN's
   * `CloseEvent.reason`). A raw WebSocket upgrade failing this way, on the
   * same origin an ordinary HTTP request to the same host just succeeded on
   * moments earlier, is the signature of something between the browser and
   * this origin's `Upgrade: websocket` handshake specifically — a VPN,
   * corporate proxy, or firewall — not a real server-side rejection.
   */
  | { kind: "opaque" }
  /** Closed abnormally after already streaming — a dropped connection, not a failed handshake. */
  | { kind: "dropped" };

export function classifyCaptionSocketClose(
  event: { code: number; reason: string },
  hasOpened: boolean,
): CaptionSocketFailure {
  if (event.reason) return { kind: "server-reason", reason: event.reason };
  if (!hasOpened) return { kind: "opaque" };
  return { kind: "dropped" };
}

/**
 * `server.ts` closes the *older* socket with 1012 when the same speaker opens a newer one
 * (last-writer-wins — see `activeCaptionStreamSockets` there). The newer socket is already
 * taking over in the same browser, so this close must neither surface an error nor trigger
 * a reconnect: retrying would evict the socket that just superseded us, which would then
 * retry and evict this one, ping-ponging forever.
 */
export const CAPTION_SOCKET_SUPERSEDED_CODE = 1012;

/** Bounds on the automatic reconnect ladder — see `decideCaptionSocketReconnect`. */
export const MAX_RECONNECT_ATTEMPTS = 5;
export const RECONNECT_BASE_DELAY_MS = 500;
export const RECONNECT_MAX_DELAY_MS = 8_000;

export type CaptionSocketRecovery =
  /** Tear down silently — a newer socket for this speaker owns the stream now. */
  | { kind: "superseded" }
  /** Transient failure; reconnect after `delayMs`. */
  | { kind: "reconnect"; delayMs: number }
  /** Give up and show `failure` to the user, with the manual Retry affordance. */
  | { kind: "surface"; failure: CaptionSocketFailure };

/**
 * Decides what a non-user-initiated caption-socket close should do. Extracted as a pure
 * function (like `classifyCaptionSocketClose` above) so the reconnect policy is testable
 * without a live socket, a `MediaRecorder`, or fake timers.
 *
 * A `server-reason` close is never retried: it's a deliberate, specific verdict ("Not
 * authorized", "Start the session before streaming captions", "…speech-to-text is not
 * configured") that won't change until something else does, and its message is already
 * actionable. "opaque"/"dropped" closes are the transient class worth retrying — a proxy
 * idle-drop, a `web` redeploy, a laptop waking from sleep.
 */
export function decideCaptionSocketReconnect({
  event,
  hasOpened,
  attempts,
  shouldCapture,
}: {
  event: { code: number; reason: string };
  hasOpened: boolean;
  /** Consecutive failures so far, reset whenever a socket reaches OPEN. */
  attempts: number;
  /** Whether capture should still be running at all (mic on, agent not taking over). */
  shouldCapture: boolean;
}): CaptionSocketRecovery {
  if (event.code === CAPTION_SOCKET_SUPERSEDED_CODE) return { kind: "superseded" };

  const failure = classifyCaptionSocketClose(event, hasOpened);
  if (failure.kind === "server-reason" || !shouldCapture || attempts >= MAX_RECONNECT_ATTEMPTS) {
    return { kind: "surface", failure };
  }
  return { kind: "reconnect", delayMs: Math.min(RECONNECT_BASE_DELAY_MS * 2 ** attempts, RECONNECT_MAX_DELAY_MS) };
}
