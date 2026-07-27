import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionStatus, TranslationMode } from "@/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("notFound");
  }),
  hasFacilitatorAccess: vi.fn(),
  sessionFindUnique: vi.fn(),
  messageCount: vi.fn(),
  buildFacilitatorAnalyticsView: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: mocks.notFound }));
vi.mock("@/lib/session-access", () => ({ hasFacilitatorAccess: mocks.hasFacilitatorAccess }));
vi.mock("@/lib/db", () => ({
  prisma: {
    session: { findUnique: mocks.sessionFindUnique },
    message: { count: mocks.messageCount },
  },
}));
vi.mock("@/lib/facilitator-analytics-view", () => ({
  buildFacilitatorAnalyticsView: mocks.buildFacilitatorAnalyticsView,
}));
vi.mock("@/lib/providers/insight", () => ({ insightProvider: { isConfigured: false } }));

const { default: FacilitatorSessionResultsPage } = await import("./page");

function session(overrides = {}) {
  return {
    id: "session-1",
    title: "Results page test",
    goal: "Verify results.",
    sourceLanguage: "en",
    learnerLanguages: ["zh"],
    retentionDays: 7,
    translationMode: TranslationMode.AUTO,
    status: SessionStatus.DRAFT,
    captionAgentActive: false,
    summary: null,
    facilitatorId: "facilitator-user",
    createdAt: new Date("2026-07-27T09:00:00.000Z"),
    startedAt: null,
    endedAt: null,
    participants: [],
    transcript: [],
    insights: [],
    ...overrides,
  };
}

describe("FacilitatorSessionResultsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasFacilitatorAccess.mockResolvedValue(true);
    mocks.sessionFindUnique.mockResolvedValue(session());
    mocks.messageCount.mockResolvedValue(0);
    mocks.buildFacilitatorAnalyticsView.mockResolvedValue({
      analytics: {
        confusionTrend: [],
        participation: [],
        blockers: { raised: 0, resolved: 0, open: 0 },
        languages: [],
        confidence: { averagePercent: 100, mediumCount: 0, lowCount: 0, byRootCause: {} },
      },
      labels: {
        analyticsDrawerLabel: "Analytics",
        analyticsDrawerOpen: "Show analytics",
        analyticsDrawerClose: "Hide analytics",
        analyticsConfusionTrendHeading: "Confusion trend",
        analyticsParticipationHeading: "Participation",
        analyticsBlockersHeading: "Blockers",
        analyticsLanguagesHeading: "Languages",
        analyticsConfidenceHeading: "Confidence Score",
        analyticsConfusionTrendSummary: "Confusion trend: 0 time buckets, highest level: CALM",
        analyticsEmptyState: "No analytics yet",
        analyticsFrozenNotice: "Final snapshot",
      },
      participationRows: [],
      blockersSummary: "0 raised · 0 resolved · 0 open",
      languageRows: [],
      confidenceSummary: "Average 100% · 0 needs-attention · 0 low-confidence",
    });
  });

  it("lets the owning facilitator access the requested session results", async () => {
    mocks.sessionFindUnique.mockResolvedValue(
      session({
        status: SessionStatus.ENDED,
        summary: "Owner-visible summary",
        endedAt: new Date("2026-07-26T10:00:00.000Z"),
      }),
    );

    const element = await FacilitatorSessionResultsPage({ params: Promise.resolve({ sessionId: "session-1" }) });
    const html = renderToStaticMarkup(element);

    expect(mocks.hasFacilitatorAccess).toHaveBeenCalledWith("session-1");
    expect(html).toContain("Owner-visible summary");
  });

  it("redirects a learner before fetching analytics", async () => {
    mocks.hasFacilitatorAccess.mockResolvedValue(false);

    await expect(
      FacilitatorSessionResultsPage({ params: Promise.resolve({ sessionId: "session-1" }) }),
    ).rejects.toThrow("redirect:/setup");

    expect(mocks.sessionFindUnique).not.toHaveBeenCalled();
    expect(mocks.buildFacilitatorAnalyticsView).not.toHaveBeenCalled();
  });

  it("redirects an unrelated facilitator before fetching analytics", async () => {
    mocks.hasFacilitatorAccess.mockResolvedValue(false);

    await expect(
      FacilitatorSessionResultsPage({ params: Promise.resolve({ sessionId: "other-session" }) }),
    ).rejects.toThrow("redirect:/setup");

    expect(mocks.hasFacilitatorAccess).toHaveBeenCalledWith("other-session");
    expect(mocks.sessionFindUnique).not.toHaveBeenCalled();
    expect(mocks.buildFacilitatorAnalyticsView).not.toHaveBeenCalled();
  });

  it("renders an empty state before the session has ended", async () => {
    const element = await FacilitatorSessionResultsPage({ params: Promise.resolve({ sessionId: "session-1" }) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Results are not ready yet");
    expect(html).toContain("Return to dashboard");
    expect(mocks.buildFacilitatorAnalyticsView).not.toHaveBeenCalled();
  });

  it("renders ended results from the requested session and counts public messages only", async () => {
    mocks.sessionFindUnique.mockResolvedValue(
      session({
        status: SessionStatus.ENDED,
        summary: "Completed summary",
        startedAt: new Date("2026-07-26T09:00:00.000Z"),
        endedAt: new Date("2026-07-26T10:00:00.000Z"),
        participants: [{ userId: "learner-a", user: { displayName: "Learner A" } }],
        insights: [{ type: "CONFUSION", summary: "Learners mixed up request validation." }],
      }),
    );
    mocks.messageCount.mockResolvedValueOnce(3).mockResolvedValueOnce(1);

    const element = await FacilitatorSessionResultsPage({ params: Promise.resolve({ sessionId: "session-1" }) });
    const html = renderToStaticMarkup(element);

    expect(mocks.sessionFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "session-1" },
      }),
    );
    expect(mocks.messageCount).toHaveBeenNthCalledWith(1, {
      where: { sessionId: "session-1", recipientId: null },
    });
    expect(mocks.messageCount).toHaveBeenNthCalledWith(2, {
      where: { sessionId: "session-1", recipientId: null, kind: "QUESTION" },
    });
    expect(mocks.buildFacilitatorAnalyticsView).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({ id: "session-1", title: "Results page test" }),
      "en",
    );
    expect(html).toContain("Results page test");
    expect(html).toContain("Completed summary");
    expect(html).toContain("3 messages");
    expect(html).toContain("1 questions");
    expect(html).toContain("Learners mixed up request validation.");
  });

  it("renders valid empty values for an ended session with no public data", async () => {
    mocks.sessionFindUnique.mockResolvedValue(
      session({
        status: SessionStatus.ENDED,
        startedAt: new Date("2026-07-26T10:00:00.000Z"),
        endedAt: new Date("2026-07-26T09:55:00.000Z"),
        summary: null,
      }),
    );
    mocks.messageCount.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

    const element = await FacilitatorSessionResultsPage({ params: Promise.resolve({ sessionId: "session-1" }) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("0 min");
    expect(html).toContain("0 messages");
    expect(html).toContain("0 questions");
    expect(html).not.toContain("-5 min");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
  });
});
