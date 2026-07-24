import { describe, expect, it } from "vitest";
import { parseInsightDraftsResponse, validateInsightDraft, type InsightDraft } from "./insight";

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

describe("parseInsightDraftsResponse", () => {
  function claudeResponse(text: string) {
    return { content: [{ type: "text", text }] };
  }

  it("parses a well-formed JSON array of drafts", () => {
    const payload = claudeResponse(
      JSON.stringify([{ type: "BLOCKER", summary: "Still 500s on empty email.", sourceSegmentIds: ["seg-1"] }]),
    );
    expect(parseInsightDraftsResponse(payload)).toEqual([
      { type: "BLOCKER", summary: "Still 500s on empty email.", sourceSegmentIds: ["seg-1"] },
    ]);
  });

  it("returns an empty array when the model reports nothing noteworthy", () => {
    expect(parseInsightDraftsResponse(claudeResponse("[]"))).toEqual([]);
  });

  it("drops entries with an invalid type", () => {
    const payload = claudeResponse(
      JSON.stringify([{ type: "SUMMARY", summary: "Not a real kind.", sourceSegmentIds: ["seg-1"] }]),
    );
    expect(parseInsightDraftsResponse(payload)).toEqual([]);
  });

  it("drops entries missing a summary or citations", () => {
    const payload = claudeResponse(
      JSON.stringify([
        { type: "DECISION", summary: "", sourceSegmentIds: ["seg-1"] },
        { type: "DECISION", summary: "Use express.json()." },
      ]),
    );
    expect(parseInsightDraftsResponse(payload)).toEqual([]);
  });

  it("never throws on malformed JSON — returns an empty array instead", () => {
    expect(parseInsightDraftsResponse(claudeResponse("not json"))).toEqual([]);
  });

  it("parses a JSON array wrapped in a markdown code fence (a common model quirk despite being told not to)", () => {
    const payload = claudeResponse(
      '```json\n[{"type": "BLOCKER", "summary": "Still 500s.", "sourceSegmentIds": ["seg-1"]}]\n```',
    );
    expect(parseInsightDraftsResponse(payload)).toEqual([
      { type: "BLOCKER", summary: "Still 500s.", sourceSegmentIds: ["seg-1"] },
    ]);
  });

  it("parses a fenced response with no language tag", () => {
    const payload = claudeResponse('```\n[{"type": "DECISION", "summary": "Use express.json().", "sourceSegmentIds": ["seg-2"]}]\n```');
    expect(parseInsightDraftsResponse(payload)).toEqual([
      { type: "DECISION", summary: "Use express.json().", sourceSegmentIds: ["seg-2"] },
    ]);
  });

  it("never throws on an unexpected response shape", () => {
    expect(parseInsightDraftsResponse({})).toEqual([]);
    expect(parseInsightDraftsResponse(null)).toEqual([]);
    expect(parseInsightDraftsResponse(undefined)).toEqual([]);
  });

  it("drops a non-array top-level JSON value", () => {
    expect(parseInsightDraftsResponse(claudeResponse(JSON.stringify({ oops: true })))).toEqual([]);
  });
});
