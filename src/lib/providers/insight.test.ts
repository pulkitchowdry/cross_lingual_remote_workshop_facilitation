import { describe, expect, it } from "vitest";
import { validateInsightDraft, type InsightDraft } from "./insight";

function draft(overrides: Partial<InsightDraft> = {}): InsightDraft {
  return { type: "BLOCKER", summary: "Group still sees a 500 error.", sourceSegmentIds: ["seg-1"], ...overrides };
}

describe("validateInsightDraft", () => {
  it("rejects a draft with no cited evidence", () => {
    expect(validateInsightDraft(draft({ sourceSegmentIds: [] }), new Set(["seg-1"]))).toBe(false);
  });

  it("rejects a draft citing a segment outside the known batch", () => {
    expect(validateInsightDraft(draft({ sourceSegmentIds: ["seg-99"] }), new Set(["seg-1"]))).toBe(false);
  });

  it("rejects a draft where only some citations are valid", () => {
    expect(validateInsightDraft(draft({ sourceSegmentIds: ["seg-1", "seg-99"] }), new Set(["seg-1"]))).toBe(false);
  });

  it("accepts a draft whose citations are all in the known batch", () => {
    expect(validateInsightDraft(draft({ sourceSegmentIds: ["seg-1"] }), new Set(["seg-1", "seg-2"]))).toBe(true);
  });
});
