import { beforeEach, describe, expect, it, vi } from "vitest";
import { ParticipantRole, SessionStatus } from "@/generated/prisma/client";
import { hashToken } from "@/lib/session-security";

const mocks = vi.hoisted(() => ({
  joinLinkFindMany: vi.fn(),
  sessionFindMany: vi.fn(),
  participantGroupBy: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    joinLink: { findMany: mocks.joinLinkFindMany },
    session: { findMany: mocks.sessionFindMany },
    sessionParticipant: { groupBy: mocks.participantGroupBy },
  },
}));

const { listFacilitatorSessionOverview } = await import("./facilitator-session-overview");

const now = new Date("2026-07-27T12:00:00.000Z");

function session(overrides: Partial<{
  id: string;
  title: string;
  goal: string;
  status: SessionStatus;
  sourceLanguage: string;
  retentionDays: number;
  createdAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
}> = {}) {
  return {
    id: "session-1",
    title: "Workshop",
    goal: "Practice the flow.",
    status: SessionStatus.LIVE,
    sourceLanguage: "en",
    retentionDays: 7,
    createdAt: new Date("2026-07-27T09:00:00.000Z"),
    startedAt: new Date("2026-07-27T10:00:00.000Z"),
    endedAt: null,
    ...overrides,
  };
}

describe("listFacilitatorSessionOverview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.joinLinkFindMany.mockResolvedValue([
      { sessionId: "session-1", tokenHash: hashToken("facilitator-token-1") },
    ]);
    mocks.sessionFindMany.mockResolvedValue([session()]);
    mocks.participantGroupBy.mockResolvedValue([{ sessionId: "session-1", _count: { _all: 2 } }]);
  });

  it("lists only sessions with a verified facilitator cookie", async () => {
    const overview = await listFacilitatorSessionOverview(
      [
        { name: "workshop-facilitator-session-1", value: "facilitator-token-1" },
        { name: "workshop-facilitator-session-2", value: "invalid-token" },
        { name: "workshop-learner-session-3", value: "learner-token" },
      ],
      now,
    );

    expect(mocks.joinLinkFindMany).toHaveBeenCalledWith({
      where: {
        role: ParticipantRole.FACILITATOR,
        revokedAt: null,
        tokenHash: { in: [hashToken("facilitator-token-1"), hashToken("invalid-token")] },
        OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
      },
      select: { sessionId: true, tokenHash: true },
    });
    expect(mocks.sessionFindMany).toHaveBeenCalledWith({
      where: { id: { in: ["session-1"] } },
      select: {
        id: true,
        title: true,
        goal: true,
        status: true,
        sourceLanguage: true,
        retentionDays: true,
        createdAt: true,
        startedAt: true,
        endedAt: true,
      },
    });
    expect(mocks.participantGroupBy).toHaveBeenCalledWith({
      by: ["sessionId"],
      where: { sessionId: { in: ["session-1"] }, role: ParticipantRole.LEARNER },
      _count: { _all: true },
    });
    expect(overview.active).toEqual([
      expect.objectContaining({ id: "session-1", status: SessionStatus.LIVE, learnerCount: 2 }),
    ]);
    expect(overview.completed).toEqual([]);
  });

  it("returns no sessions when the token belongs to a different session", async () => {
    mocks.joinLinkFindMany.mockResolvedValue([
      { sessionId: "other-session", tokenHash: hashToken("facilitator-token-1") },
    ]);

    const overview = await listFacilitatorSessionOverview(
      [{ name: "workshop-facilitator-session-1", value: "facilitator-token-1" }],
      now,
    );

    expect(overview).toEqual({ active: [], completed: [] });
    expect(mocks.sessionFindMany).not.toHaveBeenCalled();
    expect(mocks.participantGroupBy).not.toHaveBeenCalled();
  });

  it("separates active and completed sessions and sorts the newest items first", async () => {
    mocks.joinLinkFindMany.mockResolvedValue([
      { sessionId: "draft-old", tokenHash: hashToken("draft-old-token") },
      { sessionId: "live-new", tokenHash: hashToken("live-new-token") },
      { sessionId: "ended-old", tokenHash: hashToken("ended-old-token") },
      { sessionId: "ended-new", tokenHash: hashToken("ended-new-token") },
    ]);
    mocks.sessionFindMany.mockResolvedValue([
      session({
        id: "draft-old",
        status: SessionStatus.DRAFT,
        startedAt: null,
        createdAt: new Date("2026-07-25T09:00:00.000Z"),
      }),
      session({
        id: "live-new",
        status: SessionStatus.LIVE,
        createdAt: new Date("2026-07-27T09:00:00.000Z"),
        startedAt: new Date("2026-07-27T10:00:00.000Z"),
      }),
      session({
        id: "ended-old",
        status: SessionStatus.ENDED,
        startedAt: new Date("2026-07-24T09:00:00.000Z"),
        endedAt: new Date("2026-07-24T10:00:00.000Z"),
      }),
      session({
        id: "ended-new",
        status: SessionStatus.ENDED,
        startedAt: new Date("2026-07-26T09:00:00.000Z"),
        endedAt: new Date("2026-07-26T10:00:00.000Z"),
      }),
    ]);
    mocks.participantGroupBy.mockResolvedValue([]);

    const overview = await listFacilitatorSessionOverview(
      [
        { name: "workshop-facilitator-draft-old", value: "draft-old-token" },
        { name: "workshop-facilitator-live-new", value: "live-new-token" },
        { name: "workshop-facilitator-ended-old", value: "ended-old-token" },
        { name: "workshop-facilitator-ended-new", value: "ended-new-token" },
      ],
      now,
    );

    expect(overview.active.map((item) => item.id)).toEqual(["live-new", "draft-old"]);
    expect(overview.completed.map((item) => item.id)).toEqual(["ended-new", "ended-old"]);
  });

  it("excludes retention-expired sessions", async () => {
    mocks.sessionFindMany.mockResolvedValue([
      session({
        status: SessionStatus.ENDED,
        retentionDays: 1,
        startedAt: new Date("2026-07-20T09:00:00.000Z"),
        endedAt: new Date("2026-07-20T10:00:00.000Z"),
      }),
    ]);
    mocks.participantGroupBy.mockResolvedValue([]);

    const overview = await listFacilitatorSessionOverview(
      [{ name: "workshop-facilitator-session-1", value: "facilitator-token-1" }],
      now,
    );

    expect(overview).toEqual({ active: [], completed: [] });
  });

  it("does not query message, transcript, summary, or private-message fields", async () => {
    await listFacilitatorSessionOverview(
      [{ name: "workshop-facilitator-session-1", value: "facilitator-token-1" }],
      now,
    );

    const select = mocks.sessionFindMany.mock.calls[0][0].select;
    expect(select).not.toHaveProperty("messages");
    expect(select).not.toHaveProperty("transcript");
    expect(select).not.toHaveProperty("summary");
    expect(select).not.toHaveProperty("insights");
    expect(select).not.toHaveProperty("participants");
  });
});
