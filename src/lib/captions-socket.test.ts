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

    expect(() => attachCaptionSocket(ws, session)).toThrow(/cloud fallback is disabled/);

    // Advance well past the 3s duplicate-guard tick; if the interval had leaked
    // (the bug), this would still fire a DB query even though the socket was
    // never fully wired up.
    await vi.advanceTimersByTimeAsync(10_000);

    expect(findUniqueMock).not.toHaveBeenCalled();
  });
});
