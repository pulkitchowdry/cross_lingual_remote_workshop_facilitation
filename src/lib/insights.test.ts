import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InsightDraft } from "@/lib/providers/insight";
import { SessionStatus, TranslationMode, type Session } from "@/generated/prisma/client";

// selectNewDrafts is a pure function with no dependency on Prisma or Next's cache
// APIs, but importing the module that defines it (insights.ts) transitively imports
// both (@/lib/db asserts DATABASE_URL at import time; next/cache needs a request
// context) — mock both so this file can load without either.
const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  transcriptFindMany: vi.fn(),
  messageFindMany: vi.fn(),
  participantCount: vi.fn(),
  sessionUpdate: vi.fn(),
  generateSessionSummary: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    transcriptSegment: { findMany: mocks.transcriptFindMany },
    message: { findMany: mocks.messageFindMany },
    sessionParticipant: { count: mocks.participantCount },
    session: { update: mocks.sessionUpdate },
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/providers/insight", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/providers/insight")>();
  return {
    ...actual,
    insightProvider: {
      isConfigured: true,
      generateInsights: vi.fn(),
      generateSessionSummary: mocks.generateSessionSummary,
    },
  };
});

const { generateAndPersistSessionSummary, selectNewDrafts } = await import("./insights");

const knownSegmentIds = new Set(["seg-1", "seg-2", "seg-3"]);

function draft(overrides: Partial<InsightDraft> = {}): InsightDraft {
  return {
    type: "BLOCKER",
    summary: "Group still sees a 500 error on signup",
    sourceSegmentIds: ["seg-1"],
    ...overrides,
  };
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-1",
    title: "Workshop",
    goal: "Practice API design",
    sourceLanguage: "en",
    learnerLanguages: ["zh"],
    retentionDays: 7,
    translationMode: TranslationMode.AUTO,
    status: SessionStatus.ENDED,
    captionAgentActive: false,
    summary: null,
    facilitatorId: "facilitator-user",
    createdAt: new Date("2026-07-27T09:00:00.000Z"),
    startedAt: new Date("2026-07-27T09:05:00.000Z"),
    endedAt: new Date("2026-07-27T10:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transcriptFindMany.mockResolvedValue([{ originalText: "Today we practiced API validation." }]);
  mocks.messageFindMany.mockResolvedValue([{ kind: "QUESTION", originalText: "Can you repeat the validation step?" }]);
  mocks.participantCount.mockResolvedValue(2);
  mocks.generateSessionSummary.mockResolvedValue("Summary text");
  mocks.sessionUpdate.mockResolvedValue({});
});

describe("selectNewDrafts", () => {
  it("keeps a draft that doesn't duplicate anything already noted", () => {
    const result = selectNewDrafts([draft()], knownSegmentIds, []);
    expect(result).toHaveLength(1);
  });

  it("drops a draft that duplicates an already-noted summary", () => {
    const result = selectNewDrafts([draft()], knownSegmentIds, ["Group still sees a 500 error on signup"]);
    expect(result).toHaveLength(0);
  });

  it("drops a draft citing a segment id outside the known batch", () => {
    const result = selectNewDrafts([draft({ sourceSegmentIds: ["unknown-segment"] })], knownSegmentIds, []);
    expect(result).toHaveLength(0);
  });

  it("drops a draft with no cited segments", () => {
    const result = selectNewDrafts([draft({ sourceSegmentIds: [] })], knownSegmentIds, []);
    expect(result).toHaveLength(0);
  });

  // The bug this regression-tests: two near-duplicate drafts returned in the SAME
  // Claude response (rephrasing the same blocker across two segments) both passed
  // the old single-pass filter, since neither duplicated anything from BEFORE this
  // call — only sequential, running dedup within the batch itself catches this.
  it("drops an intra-batch duplicate — a second draft rephrasing the first draft in the same response", () => {
    const drafts = [
      draft({ summary: "Group still sees a 500 error on signup", sourceSegmentIds: ["seg-1"] }),
      draft({ summary: "Group still sees a 500 error during signup", sourceSegmentIds: ["seg-2"] }),
    ];
    const result = selectNewDrafts(drafts, knownSegmentIds, []);
    expect(result).toHaveLength(1);
    expect(result[0].sourceSegmentIds).toEqual(["seg-1"]);
  });

  it("keeps two distinct (non-duplicate) drafts from the same batch", () => {
    const drafts = [
      draft({ type: "BLOCKER", summary: "Group still sees a 500 error on signup", sourceSegmentIds: ["seg-1"] }),
      draft({ type: "DECISION", summary: "Group decided to use JWT for auth", sourceSegmentIds: ["seg-2"] }),
    ];
    const result = selectNewDrafts(drafts, knownSegmentIds, []);
    expect(result).toHaveLength(2);
  });

  // The bug this regression-tests: a genuine decision reversal (JWT -> OAuth) shares
  // enough bare function/scaffolding words ("group", "decided", "to", "use", "for")
  // with the original decision that plain, stopword-unaware Jaccard overlap crossed
  // the duplicate threshold, silently dropping the reversal with no error or trace.
  it("keeps a decision reversal that shares a formulaic template but differs in its actual content word", () => {
    const result = selectNewDrafts(
      [draft({ type: "DECISION", summary: "Group decided to use OAuth for auth", sourceSegmentIds: ["seg-1"] })],
      knownSegmentIds,
      ["Group decided to use JWT for auth"],
    );
    expect(result).toHaveLength(1);
  });

  it("still drops a genuine near-paraphrase of an already-noted summary", () => {
    const result = selectNewDrafts(
      [draft({ summary: "The group is still hitting a 500 error on signup" })],
      knownSegmentIds,
      ["Group still sees a 500 error on signup"],
    );
    expect(result).toHaveLength(0);
  });
});

describe("generateAndPersistSessionSummary", () => {
  it("selects only public messages for post-session summary inputs", async () => {
    await generateAndPersistSessionSummary(session());

    expect(mocks.messageFindMany).toHaveBeenCalledWith({
      where: { sessionId: "session-1", recipientId: null },
      select: { kind: true, originalText: true },
    });
    expect(mocks.generateSessionSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        learnerQuestions: ["Can you repeat the validation step?"],
        messageCount: 1,
        questionCount: 1,
      }),
    );
  });
});
