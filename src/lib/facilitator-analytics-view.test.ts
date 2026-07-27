import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionStatus } from "@/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  insightFindMany: vi.fn(),
  messageGroupBy: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    insight: { findMany: mocks.insightFindMany },
    message: { groupBy: mocks.messageGroupBy },
  },
}));

const { buildFacilitatorAnalyticsView } = await import("./facilitator-analytics-view");

describe("buildFacilitatorAnalyticsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insightFindMany.mockResolvedValue([]);
    mocks.messageGroupBy.mockResolvedValue([]);
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
        transcript: [],
      },
      "en",
    );

    expect(mocks.messageGroupBy).toHaveBeenCalledWith({
      by: ["senderId", "kind", "isAnonymous"],
      where: { sessionId: "session-1", recipientId: null },
      _count: true,
    });
  });
});
