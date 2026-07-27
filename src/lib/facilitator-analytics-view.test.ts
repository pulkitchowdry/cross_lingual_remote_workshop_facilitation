import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionStatus } from "@/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  insightFindMany: vi.fn(),
  messageGroupBy: vi.fn(),
  translationFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    insight: { findMany: mocks.insightFindMany },
    message: { groupBy: mocks.messageGroupBy },
    translation: { findMany: mocks.translationFindMany },
  },
}));

const { buildFacilitatorAnalyticsView } = await import("./facilitator-analytics-view");

describe("buildFacilitatorAnalyticsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insightFindMany.mockResolvedValue([]);
    mocks.messageGroupBy.mockResolvedValue([]);
    mocks.translationFindMany.mockResolvedValue([]);
  });

  it("builds participation analytics from public messages only", async () => {
    await buildFacilitatorAnalyticsView(
      "session-1",
      {
        startedAt: new Date("2026-07-27T09:00:00.000Z"),
        createdAt: new Date("2026-07-27T08:50:00.000Z"),
        status: SessionStatus.ENDED,
        endedAt: new Date("2026-07-27T10:00:00.000Z"),
        participants: [{ userId: "learner-a", user: { displayName: "Learner A" } }],
      },
      "en",
    );

    expect(mocks.messageGroupBy).toHaveBeenCalledWith({
      by: ["senderId", "kind", "isAnonymous"],
      where: { sessionId: "session-1", recipientId: null },
      _count: true,
    });
  });

  it("scopes every analytics query to the requested session", async () => {
    await buildFacilitatorAnalyticsView(
      "session-2",
      {
        startedAt: new Date("2026-07-27T09:00:00.000Z"),
        createdAt: new Date("2026-07-27T08:50:00.000Z"),
        status: SessionStatus.LIVE,
        endedAt: null,
        participants: [],
      },
      "en",
    );

    expect(mocks.insightFindMany).toHaveBeenNthCalledWith(1, {
      where: { sessionId: "session-2", type: "BLOCKER" },
      select: { status: true, createdAt: true },
    });
    expect(mocks.messageGroupBy).toHaveBeenCalledWith({
      by: ["senderId", "kind", "isAnonymous"],
      where: { sessionId: "session-2", recipientId: null },
      _count: true,
    });
    expect(mocks.insightFindMany).toHaveBeenNthCalledWith(2, {
      where: { sessionId: "session-2", type: "CONFUSION" },
      select: { createdAt: true },
    });
    expect(mocks.translationFindMany).toHaveBeenCalledWith({
      where: { transcriptSegment: { sessionId: "session-2" } },
      select: { targetLanguage: true, confidence: true, confidenceLevel: true, rootCause: true },
    });
  });

  it("uses all session translations for language and confidence metrics instead of capped caller transcript", async () => {
    mocks.translationFindMany.mockResolvedValue([
      { targetLanguage: "zh", confidence: 100, confidenceLevel: "high", rootCause: null },
      { targetLanguage: "zh", confidence: 80, confidenceLevel: "medium", rootCause: "terminology" },
      { targetLanguage: "es", confidence: 40, confidenceLevel: "low", rootCause: "audio" },
    ]);

    const view = await buildFacilitatorAnalyticsView(
      "session-1",
      {
        startedAt: new Date("2026-07-27T09:00:00.000Z"),
        createdAt: new Date("2026-07-27T08:50:00.000Z"),
        status: SessionStatus.ENDED,
        endedAt: new Date("2026-07-27T10:00:00.000Z"),
        participants: [],
      },
      "en",
    );

    expect(view.analytics.languages).toEqual([
      { language: "zh", translationCount: 2 },
      { language: "es", translationCount: 1 },
    ]);
    expect(view.analytics.confidence).toEqual({
      averagePercent: 73,
      mediumCount: 1,
      lowCount: 1,
      byRootCause: { terminology: 1, audio: 1 },
    });
  });

  it("treats a session with only private messages like no public chat for participation", async () => {
    mocks.messageGroupBy.mockResolvedValue([]);

    const view = await buildFacilitatorAnalyticsView(
      "session-1",
      {
        startedAt: new Date("2026-07-27T09:00:00.000Z"),
        createdAt: new Date("2026-07-27T08:50:00.000Z"),
        status: SessionStatus.ENDED,
        endedAt: new Date("2026-07-27T10:00:00.000Z"),
        participants: [{ userId: "learner-a", user: { displayName: "Learner A" } }],
      },
      "en",
    );

    expect(view.analytics.participation).toEqual([
      { userId: "learner-a", displayName: "Learner A", messageCount: 0, questionCount: 0, isAnonymousAny: false },
    ]);
  });
});
