import { describe, expect, it } from "vitest";
import {
  CAPTION_SOCKET_SUPERSEDED_CODE,
  MAX_RECONNECT_ATTEMPTS,
  RECONNECT_MAX_DELAY_MS,
  classifyCaptionSocketClose,
  decideCaptionSocketReconnect,
} from "@/lib/caption-socket-client";

describe("classifyCaptionSocketClose", () => {
  it("trusts a server-provided reason regardless of whether the socket had opened", () => {
    expect(classifyCaptionSocketClose({ code: 1011, reason: "Not authorized for this session." }, false)).toEqual({
      kind: "server-reason",
      reason: "Not authorized for this session.",
    });
    expect(classifyCaptionSocketClose({ code: 1011, reason: "Start the session before streaming captions." }, true)).toEqual(
      { kind: "server-reason", reason: "Start the session before streaming captions." },
    );
  });

  it("classifies a reasonless closure that never opened as opaque", () => {
    expect(classifyCaptionSocketClose({ code: 1006, reason: "" }, false)).toEqual({ kind: "opaque" });
  });

  it("classifies a reasonless closure after opening as a dropped connection, not opaque", () => {
    expect(classifyCaptionSocketClose({ code: 1006, reason: "" }, true)).toEqual({ kind: "dropped" });
  });
});

describe("decideCaptionSocketReconnect", () => {
  const dropped = { event: { code: 1006, reason: "" }, hasOpened: true, attempts: 0, shouldCapture: true };

  it("tears down silently when a newer socket for the same speaker superseded this one", () => {
    // Retrying here would evict the socket that just took over, which would then retry and
    // evict this one — the ping-pong the 1012 special case exists to prevent.
    expect(
      decideCaptionSocketReconnect({ ...dropped, event: { code: CAPTION_SOCKET_SUPERSEDED_CODE, reason: "Superseded." } }),
    ).toEqual({ kind: "superseded" });
  });

  it("reconnects a dropped connection with exponential backoff", () => {
    expect(decideCaptionSocketReconnect({ ...dropped, attempts: 0 })).toEqual({ kind: "reconnect", delayMs: 500 });
    expect(decideCaptionSocketReconnect({ ...dropped, attempts: 1 })).toEqual({ kind: "reconnect", delayMs: 1_000 });
    expect(decideCaptionSocketReconnect({ ...dropped, attempts: 2 })).toEqual({ kind: "reconnect", delayMs: 2_000 });
  });

  it("reconnects an opaque (never-opened) closure too — a blocked upgrade can be transient", () => {
    expect(decideCaptionSocketReconnect({ ...dropped, hasOpened: false })).toEqual({ kind: "reconnect", delayMs: 500 });
  });

  it("caps the backoff delay at the final attempt", () => {
    // The last retry the budget allows (attempts === MAX - 1) lands exactly on the cap, so
    // no reachable attempt can ever schedule a longer wait than RECONNECT_MAX_DELAY_MS.
    expect(decideCaptionSocketReconnect({ ...dropped, attempts: MAX_RECONNECT_ATTEMPTS - 1 })).toEqual({
      kind: "reconnect",
      delayMs: RECONNECT_MAX_DELAY_MS,
    });
  });

  it("never retries a server-provided reason — the verdict won't change on its own", () => {
    const event = { code: 1011, reason: "Start the session before streaming captions." };
    expect(decideCaptionSocketReconnect({ ...dropped, event })).toEqual({
      kind: "surface",
      failure: { kind: "server-reason", reason: "Start the session before streaming captions." },
    });
  });

  it("surfaces instead of retrying once the attempt budget is spent", () => {
    expect(decideCaptionSocketReconnect({ ...dropped, attempts: MAX_RECONNECT_ATTEMPTS })).toEqual({
      kind: "surface",
      failure: { kind: "dropped" },
    });
  });

  it("does not reconnect when capture should no longer be running", () => {
    // The mic was muted (or the server-side agent took over) while this socket was dying —
    // reconnecting would resurrect capture the user just turned off.
    expect(decideCaptionSocketReconnect({ ...dropped, shouldCapture: false })).toEqual({
      kind: "surface",
      failure: { kind: "dropped" },
    });
  });
});
