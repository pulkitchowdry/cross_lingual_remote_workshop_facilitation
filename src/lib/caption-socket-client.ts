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
