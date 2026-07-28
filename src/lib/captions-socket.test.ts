import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import type { Session } from "@/generated/prisma/client";

const findUniqueMock = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { session: { findUnique: findUniqueMock } } }));
vi.mock("@/lib/captions", () => ({ publishTranslatedCaption: vi.fn() }));

const openStreamMock = vi.fn();
vi.mock("@/lib/providers/speech-to-text", () => ({
  speechToTextProvider: { openStream: openStreamMock },
}));

describe("closeWithReason", () => {
  it("passes a short reason through unchanged", async () => {
    const { closeWithReason } = await import("@/lib/captions-socket");
    const close = vi.fn();
    const ws = { close } as unknown as WebSocket;

    closeWithReason(ws, 1011, "Not authorized for this session.");

    expect(close).toHaveBeenCalledWith(1011, "Not authorized for this session.");
  });

  it("truncates a reason over ws's 123-byte close-frame limit instead of letting ws.close() throw", async () => {
    const { closeWithReason } = await import("@/lib/captions-socket");
    const close = vi.fn();
    const ws = { close } as unknown as WebSocket;
    // Mirrors a real Deepgram close reason echoed into our own wrapping message
    // (speech-to-text.ts's DeepgramStreamingSession) — long enough on its own
    // to blow past the RFC 6455 123-byte reason limit once wrapped.
    const longReason =
      "Deepgram streaming connection closed unexpectedly (code 1011: Corrupt or unsupported audio data received; please verify the encoding, sample rate, and channel count match the stream parameters and retry).";
    expect(Buffer.byteLength(longReason, "utf8")).toBeGreaterThan(123);

    closeWithReason(ws, 1011, longReason);

    expect(close).toHaveBeenCalledTimes(1);
    const [code, sentReason] = close.mock.calls[0] as [number, string];
    expect(code).toBe(1011);
    expect(Buffer.byteLength(sentReason, "utf8")).toBeLessThanOrEqual(123);
  });
});

describe("attachCaptionSocket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    findUniqueMock.mockReset();
    openStreamMock.mockReset();
  });

  it("clears the duplicate-capture interval when openStream throws synchronously, instead of leaking a DB-querying interval forever", async () => {
    // Mirrors the real failure this guards against: a strict-privacy session with
    // no local-inference tier configured — see speech-to-text.ts's openStream.
    openStreamMock.mockImplementation(() => {
      throw new Error("Local caption service is not configured and cloud fallback is disabled for this session.");
    });
    const { attachCaptionSocket } = await import("@/lib/captions-socket");
    const ws = { on: vi.fn(), send: vi.fn(), close: vi.fn() } as unknown as WebSocket;
    const session = {
      id: "session-1",
      sourceLanguage: "en",
      translationMode: "LOCAL_ONLY",
    } as unknown as Session;

    expect(() => attachCaptionSocket(ws, session, { role: "facilitator" }, "en")).toThrow(/cloud fallback is disabled/);

    // Advance well past the 3s duplicate-guard tick; if the interval had leaked
    // (the bug), this would still fire a DB query even though the socket was
    // never fully wired up.
    await vi.advanceTimersByTimeAsync(10_000);

    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("releases the STT stream and the duplicate-capture interval when the socket is already closed, instead of leaking both per reconnect", async () => {
    // The production failure this guards: authorization is async (several DB round trips),
    // and Railway's logs show the socket closing at age=2ms while `attached` only lands at
    // age=6ms. `ws` emits `close` exactly once, so the handlers registered at the end of
    // `attachCaptionSocket` are dead code on an already-closed socket — leaking one STT
    // stream and one 3s Postgres-polling interval on EVERY 500ms client retry.
    const close = vi.fn();
    openStreamMock.mockReturnValue({ sendAudio: vi.fn(), close });
    const { attachCaptionSocket } = await import("@/lib/captions-socket");
    const listeners = vi.fn();
    const ws = {
      on: listeners,
      send: vi.fn(),
      close: vi.fn(),
      readyState: 3, // CLOSED
      OPEN: 1,
    } as unknown as WebSocket;
    const session = { id: "session-1", sourceLanguage: "en", translationMode: "AUTO" } as unknown as Session;

    attachCaptionSocket(ws, session, { role: "facilitator" }, "en");

    expect(close).toHaveBeenCalledTimes(1);
    // And the interval is gone, so it can never poll Postgres for a socket nobody holds.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("leaves a live socket's STT stream open, so the closed-socket guard can't tear down a healthy connection", async () => {
    const close = vi.fn();
    openStreamMock.mockReturnValue({ sendAudio: vi.fn(), close });
    const { attachCaptionSocket } = await import("@/lib/captions-socket");
    const ws = { on: vi.fn(), send: vi.fn(), close: vi.fn(), readyState: 1, OPEN: 1 } as unknown as WebSocket;
    const session = { id: "session-1", sourceLanguage: "en", translationMode: "AUTO" } as unknown as Session;

    attachCaptionSocket(ws, session, { role: "facilitator" }, "en");

    expect(close).not.toHaveBeenCalled();
    // The facilitator duplicate-capture guard is still running, as it should be.
    findUniqueMock.mockResolvedValue({ captionAgentActive: false });
    await vi.advanceTimersByTimeAsync(3_500);
    expect(findUniqueMock).toHaveBeenCalled();
  });
});
