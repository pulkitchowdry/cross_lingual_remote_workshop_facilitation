import { describe, expect, it, vi } from "vitest";
import type { InsightDraft } from "@/lib/providers/insight";

// selectNewDrafts is a pure function with no dependency on Prisma or Next's cache
// APIs, but importing the module that defines it (insights.ts) transitively imports
// both (@/lib/db asserts DATABASE_URL at import time; next/cache needs a request
// context) — mock both so this file can load without either.
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { selectNewDrafts } = await import("./insights");

const knownSegmentIds = new Set(["seg-1", "seg-2", "seg-3"]);

function draft(overrides: Partial<InsightDraft> = {}): InsightDraft {
  return {
    type: "BLOCKER",
    summary: "Group still sees a 500 error on signup",
    sourceSegmentIds: ["seg-1"],
    ...overrides,
  };
}

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
});
