import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionStatus } from "@/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  revalidatePath: vi.fn(),
  hasFacilitatorAccess: vi.fn(),
  sessionUpdateMany: vi.fn(),
  sessionFindUnique: vi.fn(),
  sessionFindUniqueOrThrow: vi.fn(),
  generateAndPersistSessionSummary: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/session-access", () => ({ hasFacilitatorAccess: mocks.hasFacilitatorAccess }));
vi.mock("@/lib/db", () => ({
  prisma: {
    session: {
      update: vi.fn(),
      updateMany: mocks.sessionUpdateMany,
      findUnique: mocks.sessionFindUnique,
      findUniqueOrThrow: mocks.sessionFindUniqueOrThrow,
    },
    joinLink: { updateMany: vi.fn() },
    insight: { updateMany: vi.fn() },
  },
}));
vi.mock("@/lib/insights", () => ({
  generateAndPersistSessionSummary: mocks.generateAndPersistSessionSummary,
}));
vi.mock("@/lib/captions", () => ({ publishTranslatedCaption: vi.fn() }));
vi.mock("@/lib/providers/room", () => ({ roomProvider: { setPresenterAccess: vi.fn() } }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: vi.fn(() => false) }));

const { endSession } = await import("./actions");

function formData() {
  return new FormData();
}

function endedSession() {
  return {
    id: "session-1",
    title: "Ending workshop",
    goal: "Review redirect.",
    sourceLanguage: "en",
    learnerLanguages: ["zh"],
    retentionDays: 7,
    translationMode: "AUTO",
    status: SessionStatus.ENDED,
    captionAgentActive: false,
    summary: null,
    facilitatorId: "facilitator-user",
    createdAt: new Date("2026-07-27T09:00:00.000Z"),
    startedAt: new Date("2026-07-27T10:00:00.000Z"),
    endedAt: new Date("2026-07-27T11:00:00.000Z"),
  };
}

describe("endSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasFacilitatorAccess.mockResolvedValue(true);
    mocks.sessionUpdateMany.mockResolvedValue({ count: 1 });
    mocks.sessionFindUniqueOrThrow.mockResolvedValue(endedSession());
    mocks.generateAndPersistSessionSummary.mockResolvedValue(undefined);
  });

  it("redirects to the session results page only after the LIVE session is ended", async () => {
    await expect(endSession("session-1", { error: null }, formData())).rejects.toThrow(
      "redirect:/sessions/session-1/facilitator/results",
    );

    expect(mocks.hasFacilitatorAccess).toHaveBeenCalledWith("session-1");
    expect(mocks.sessionUpdateMany).toHaveBeenCalledWith({
      where: { id: "session-1", status: SessionStatus.LIVE },
      data: { status: SessionStatus.ENDED, endedAt: expect.any(Date) },
    });
    expect(mocks.sessionFindUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "session-1" } });
    expect(mocks.generateAndPersistSessionSummary).toHaveBeenCalledWith(expect.objectContaining({ id: "session-1" }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/sessions/session-1/facilitator");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/sessions/session-1/facilitator/results");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/sessions/session-1/learn");
    expect(mocks.redirect).toHaveBeenCalledWith("/sessions/session-1/facilitator/results");
  });

  it("redirects unauthorized users before mutating session data", async () => {
    mocks.hasFacilitatorAccess.mockResolvedValue(false);

    await expect(endSession("session-1", { error: null }, formData())).rejects.toThrow("redirect:/setup");

    expect(mocks.sessionUpdateMany).not.toHaveBeenCalled();
    expect(mocks.generateAndPersistSessionSummary).not.toHaveBeenCalled();
  });

  it("shows a retryable error and does not redirect when ending the session fails", async () => {
    mocks.sessionUpdateMany.mockRejectedValue(new Error("database unavailable"));

    const result = await endSession("session-1", { error: null }, formData());

    expect(result).toEqual({ error: "Couldn't end the session. Please try again." });
    expect(mocks.redirect).not.toHaveBeenCalledWith("/sessions/session-1/facilitator/results");
    expect(mocks.generateAndPersistSessionSummary).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("does not redirect or regenerate summaries for an already-ended duplicate submission", async () => {
    mocks.sessionUpdateMany.mockResolvedValue({ count: 0 });
    mocks.sessionFindUnique.mockResolvedValue({ status: SessionStatus.ENDED });

    const result = await endSession("session-1", { error: null }, formData());

    expect(result).toEqual({ error: "This session has already ended. Refresh the page to view its results." });
    expect(mocks.sessionFindUnique).toHaveBeenCalledWith({
      where: { id: "session-1" },
      select: { status: true },
    });
    expect(mocks.sessionFindUniqueOrThrow).not.toHaveBeenCalled();
    expect(mocks.generateAndPersistSessionSummary).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalledWith("/sessions/session-1/facilitator/results");
  });

  it("keeps non-live stale submissions on the current page with an inline error", async () => {
    mocks.sessionUpdateMany.mockResolvedValue({ count: 0 });
    mocks.sessionFindUnique.mockResolvedValue({ status: SessionStatus.DRAFT });

    const result = await endSession("session-1", { error: null }, formData());

    expect(result).toEqual({ error: "This session is not live anymore. Refresh the page and try again." });
    expect(mocks.generateAndPersistSessionSummary).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalledWith("/sessions/session-1/facilitator/results");
  });
});
