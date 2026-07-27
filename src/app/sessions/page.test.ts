import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionStatus } from "@/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  headersGet: vi.fn(),
  cookiesGetAll: vi.fn(),
  listFacilitatorSessionOverview: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({ get: mocks.headersGet })),
  cookies: vi.fn(async () => ({ getAll: mocks.cookiesGetAll })),
}));
vi.mock("@/components/LanguageSwitcher", () => ({
  LanguageSwitcher: ({ basePath }: { basePath: string }) =>
    React.createElement("div", { "data-base-path": basePath }),
}));
vi.mock("@/components/SyncUiLanguage", () => ({
  SyncUiLanguage: ({ lang }: { lang: string }) => React.createElement("div", { "data-lang": lang }),
}));
vi.mock("@/lib/facilitator-session-overview", () => ({
  listFacilitatorSessionOverview: mocks.listFacilitatorSessionOverview,
}));

const { default: SessionsOverviewPage } = await import("./page");

function overviewSession(overrides: Partial<{
  id: string;
  title: string;
  goal: string;
  status: SessionStatus;
  sourceLanguage: string;
  learnerCount: number;
  createdAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
}> = {}) {
  return {
    id: "session-1",
    title: "REST endpoint workshop",
    goal: "Implement validation.",
    status: SessionStatus.LIVE,
    sourceLanguage: "en",
    learnerCount: 2,
    createdAt: new Date("2026-07-27T08:00:00.000Z"),
    startedAt: new Date("2026-07-27T09:00:00.000Z"),
    endedAt: null,
    ...overrides,
  };
}

describe("SessionsOverviewPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.headersGet.mockReturnValue("en-US,en;q=0.9");
    mocks.cookiesGetAll.mockReturnValue([{ name: "workshop-facilitator-session-1", value: "token" }]);
    mocks.listFacilitatorSessionOverview.mockResolvedValue({ active: [], completed: [] });
  });

  it("passes request cookies to the server-side overview query", async () => {
    await SessionsOverviewPage({ searchParams: Promise.resolve({}) });

    expect(mocks.listFacilitatorSessionOverview).toHaveBeenCalledWith([
      { name: "workshop-facilitator-session-1", value: "token" },
    ]);
  });

  it("renders active and completed sessions with the correct actions", async () => {
    mocks.listFacilitatorSessionOverview.mockResolvedValue({
      active: [
        overviewSession({ id: "draft-session", status: SessionStatus.DRAFT, title: "Draft workshop", startedAt: null }),
        overviewSession({ id: "live-session", status: SessionStatus.LIVE, title: "Live workshop" }),
      ],
      completed: [
        overviewSession({
          id: "ended-session",
          status: SessionStatus.ENDED,
          title: "Ended workshop",
          startedAt: new Date("2026-07-26T09:00:00.000Z"),
          endedAt: new Date("2026-07-26T10:00:00.000Z"),
          learnerCount: 1,
        }),
      ],
    });

    const element = await SessionsOverviewPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Active sessions");
    expect(html).toContain("Completed sessions");
    expect(html).toContain("Draft workshop");
    expect(html).toContain("Live workshop");
    expect(html).toContain("Ended workshop");
    expect(html).toContain("2 learners");
    expect(html).toContain("1 learner");
    expect(html).toContain('href="/sessions/draft-session/facilitator"');
    expect(html).toContain('href="/sessions/live-session/facilitator/room"');
    expect(html).toContain('href="/sessions/ended-session/facilitator/results"');
  });

  it("renders an empty state when no facilitator-owned sessions are available", async () => {
    const element = await SessionsOverviewPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("No facilitator sessions found");
    expect(html).toContain("This page only shows sessions for which this browser has facilitator access.");
    expect(html).toContain('href="/setup"');
  });

  it("renders localized labels from the requested language", async () => {
    const element = await SessionsOverviewPage({ searchParams: Promise.resolve({ lang: "zh" }) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("未找到主持人场次");
    expect(html).toContain("新建场次");
  });
});
