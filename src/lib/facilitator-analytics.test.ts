import { describe, expect, it } from "vitest";
import {
  computeConfusionTrend,
  computeParticipation,
  computeParticipationFromGroups,
  computeBlockerStats,
  computeActiveActionItems,
  computeLanguageStats,
  computeConfidenceStats,
} from "@/lib/facilitator-analytics";

const NOW = new Date("2026-07-26T12:00:00.000Z");
const SESSION_START = new Date("2026-07-26T11:40:00.000Z"); // 20 min before NOW
const BUCKET_MS = 10 * 60 * 1000;
/** A small class where the ratio-based HIGH threshold never becomes the limiting
 * factor for these counts (matches this suite's pre-normalization expectations). */
const SMALL_CLASS = 5;

function minutesAfterStart(minutes: number): Date {
  return new Date(SESSION_START.getTime() + minutes * 60 * 1000);
}

describe("computeConfusionTrend", () => {
  it("returns one CALM bucket per bucketMs-sized window from sessionStart to now, with no data", () => {
    const result = computeConfusionTrend([], SESSION_START, NOW, SMALL_CLASS, BUCKET_MS);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ bucketStart: SESSION_START, groupLevel: "CALM", count: 0 });
    expect(result[1]).toEqual({
      bucketStart: new Date(SESSION_START.getTime() + BUCKET_MS),
      groupLevel: "CALM",
      count: 0,
    });
  });

  it("buckets timestamps into the correct window and derives level via existing thresholds", () => {
    const timestamps = [minutesAfterStart(1), minutesAfterStart(2), minutesAfterStart(3)];
    const result = computeConfusionTrend(timestamps, SESSION_START, NOW, SMALL_CLASS, BUCKET_MS);
    expect(result[0]).toEqual({ bucketStart: SESSION_START, groupLevel: "HIGH", count: 3 });
    expect(result[1].count).toBe(0);
  });

  it("normalizes the HIGH threshold by participant count, unlike a fixed absolute cutoff", () => {
    const timestamps = [minutesAfterStart(1), minutesAfterStart(2), minutesAfterStart(3)];
    // Same 3 confused learners as above, but out of a 20-person class (15%) — an
    // ordinary rate, not an urgent one.
    const result = computeConfusionTrend(timestamps, SESSION_START, NOW, 20, BUCKET_MS);
    expect(result[0]).toEqual({ bucketStart: SESSION_START, groupLevel: "SOME", count: 3 });
  });

  it("returns a single bucket when sessionStart equals now", () => {
    const result = computeConfusionTrend([], NOW, NOW, SMALL_CLASS, BUCKET_MS);
    expect(result).toEqual([{ bucketStart: NOW, groupLevel: "CALM", count: 0 }]);
  });

  it("ignores future timestamps and invalid bucket sizes instead of producing invalid buckets", () => {
    expect(computeConfusionTrend([new Date(NOW.getTime() + 60_000)], SESSION_START, NOW, SMALL_CLASS, BUCKET_MS)).toEqual([
      { bucketStart: SESSION_START, groupLevel: "CALM", count: 0 },
      { bucketStart: new Date(SESSION_START.getTime() + BUCKET_MS), groupLevel: "CALM", count: 0 },
    ]);
    expect(computeConfusionTrend([minutesAfterStart(1)], SESSION_START, NOW, SMALL_CLASS, 0)).toEqual([
      { bucketStart: SESSION_START, groupLevel: "CALM", count: 0 },
    ]);
  });
});

describe("computeParticipation", () => {
  const participants = [
    { userId: "u1", displayName: "Alice" },
    { userId: "u2", displayName: "Bob" },
  ];

  it("returns zero counts for participants with no messages", () => {
    expect(computeParticipation([], participants)).toEqual([
      { userId: "u1", displayName: "Alice", messageCount: 0, questionCount: 0, isAnonymousAny: false },
      { userId: "u2", displayName: "Bob", messageCount: 0, questionCount: 0, isAnonymousAny: false },
    ]);
  });

  it("counts messages and questions per sender, and flags any anonymous message", () => {
    const messages = [
      { senderId: "u1", kind: "CHAT", isAnonymous: false },
      { senderId: "u1", kind: "QUESTION", isAnonymous: true },
      { senderId: "u2", kind: "CHAT", isAnonymous: false },
    ];
    const result = computeParticipation(messages, participants);
    expect(result.find((r) => r.userId === "u1")).toEqual({
      userId: "u1",
      displayName: "Alice",
      messageCount: 2,
      questionCount: 1,
      isAnonymousAny: true,
    });
    expect(result.find((r) => r.userId === "u2")).toEqual({
      userId: "u2",
      displayName: "Bob",
      messageCount: 1,
      questionCount: 0,
      isAnonymousAny: false,
    });
  });

  it("ignores messages from senders not in the participants list", () => {
    const messages = [{ senderId: "unknown", kind: "CHAT", isAnonymous: false }];
    const result = computeParticipation(messages, participants);
    expect(result.every((r) => r.messageCount === 0)).toBe(true);
  });
});

describe("computeParticipationFromGroups", () => {
  const participants = [
    { userId: "u1", displayName: "Alice" },
    { userId: "u2", displayName: "Bob" },
  ];

  it("returns zero counts for participants with no groups", () => {
    expect(computeParticipationFromGroups([], participants)).toEqual([
      { userId: "u1", displayName: "Alice", messageCount: 0, questionCount: 0, isAnonymousAny: false },
      { userId: "u2", displayName: "Bob", messageCount: 0, questionCount: 0, isAnonymousAny: false },
    ]);
  });

  it("expands grouped counts identically to computeParticipation on the equivalent flat messages", () => {
    const groups = [
      { senderId: "u1", kind: "CHAT", isAnonymous: false, _count: 1 },
      { senderId: "u1", kind: "QUESTION", isAnonymous: true, _count: 2 },
      { senderId: "u2", kind: "CHAT", isAnonymous: false, _count: 1 },
    ];
    const flatMessages = [
      { senderId: "u1", kind: "CHAT", isAnonymous: false },
      { senderId: "u1", kind: "QUESTION", isAnonymous: true },
      { senderId: "u1", kind: "QUESTION", isAnonymous: true },
      { senderId: "u2", kind: "CHAT", isAnonymous: false },
    ];
    expect(computeParticipationFromGroups(groups, participants)).toEqual(
      computeParticipation(flatMessages, participants),
    );
    expect(computeParticipationFromGroups(groups, participants).find((r) => r.userId === "u1")).toEqual({
      userId: "u1",
      displayName: "Alice",
      messageCount: 3,
      questionCount: 2,
      isAnonymousAny: true,
    });
  });

  it("ignores groups from senders not in the participants list", () => {
    const groups = [{ senderId: "unknown", kind: "CHAT", isAnonymous: false, _count: 5 }];
    const result = computeParticipationFromGroups(groups, participants);
    expect(result.every((r) => r.messageCount === 0)).toBe(true);
  });

  it("keeps duplicate grouped records as duplicate stored data", () => {
    const groups = [
      { senderId: "u1", kind: "CHAT", isAnonymous: false, _count: 1 },
      { senderId: "u1", kind: "CHAT", isAnonymous: false, _count: 1 },
    ];

    expect(computeParticipationFromGroups(groups, participants).find((r) => r.userId === "u1")).toEqual({
      userId: "u1",
      displayName: "Alice",
      messageCount: 2,
      questionCount: 0,
      isAnonymousAny: false,
    });
  });

  it("does not emit negative counts from invalid grouped input", () => {
    const groups = [{ senderId: "u1", kind: "QUESTION", isAnonymous: true, _count: -3 }];

    expect(computeParticipationFromGroups(groups, participants).find((r) => r.userId === "u1")).toEqual({
      userId: "u1",
      displayName: "Alice",
      messageCount: 0,
      questionCount: 0,
      isAnonymousAny: false,
    });
  });
});

describe("computeBlockerStats", () => {
  it("returns all zeros and null avgResolutionMs for no insights", () => {
    expect(computeBlockerStats([])).toEqual({ raised: 0, resolved: 0, open: 0, avgResolutionMs: null });
  });

  it("counts only BLOCKER-type insights, splitting ACTIVE vs RESOLVED", () => {
    const insights = [
      { type: "BLOCKER", status: "ACTIVE", createdAt: NOW, resolvedAt: null },
      { type: "BLOCKER", status: "RESOLVED", createdAt: NOW, resolvedAt: null },
      { type: "CONFUSION", status: "ACTIVE", createdAt: NOW, resolvedAt: null },
      { type: "ACTIVITY", status: "ACTIVE", createdAt: NOW, resolvedAt: null },
    ];
    expect(computeBlockerStats(insights)).toEqual({ raised: 2, resolved: 1, open: 1, avgResolutionMs: null });
  });

  it("avgResolutionMs is always null (no resolvedAt column exists yet)", () => {
    const insights = [{ type: "BLOCKER", status: "RESOLVED", createdAt: NOW, resolvedAt: NOW }];
    expect(computeBlockerStats(insights).avgResolutionMs).toBeNull();
  });
});

describe("computeActiveActionItems", () => {
  it("uses the original text unchanged when the evidence was already spoken in the source language", () => {
    const insights = [
      {
        id: "i1",
        type: "BLOCKER",
        summary: "Learners can't reach the shared doc",
        evidence: [{ transcriptSegment: { originalText: "I can't open the link", language: "en", translations: [] } }],
      },
    ];
    expect(computeActiveActionItems(insights, "en", "en", "Translation unavailable")).toEqual([
      { id: "i1", type: "BLOCKER", summary: "Learners can't reach the shared doc", evidenceText: "I can't open the link", evidenceLang: "en" },
    ]);
  });

  it("uses the matching translation when the evidence was spoken in another language", () => {
    const insights = [
      {
        id: "i1",
        type: "CONFUSION",
        summary: "Several learners seem lost on this step",
        evidence: [
          {
            transcriptSegment: {
              originalText: "我听不懂",
              language: "zh",
              translations: [{ targetLanguage: "en", text: "I don't understand" }],
            },
          },
        ],
      },
    ];
    expect(computeActiveActionItems(insights, "en", "en", "Translation unavailable")).toEqual([
      { id: "i1", type: "CONFUSION", summary: "Several learners seem lost on this step", evidenceText: "I don't understand", evidenceLang: "en" },
    ]);
  });

  it("falls back to the fallback text/lang when no matching translation exists yet", () => {
    const insights = [
      {
        id: "i1",
        type: "BLOCKER",
        summary: "Blocked on setup",
        evidence: [{ transcriptSegment: { originalText: "我听不懂", language: "zh", translations: [] } }],
      },
    ];
    expect(computeActiveActionItems(insights, "en", "es", "Translation unavailable")).toEqual([
      { id: "i1", type: "BLOCKER", summary: "Blocked on setup", evidenceText: "Translation unavailable", evidenceLang: "es" },
    ]);
  });

  it("returns null evidence fields when an insight has no evidence at all", () => {
    const insights = [{ id: "i1", type: "BLOCKER", summary: "No evidence attached", evidence: [] }];
    expect(computeActiveActionItems(insights, "en", "en", "Translation unavailable")).toEqual([
      { id: "i1", type: "BLOCKER", summary: "No evidence attached", evidenceText: null, evidenceLang: null },
    ]);
  });
});

describe("computeLanguageStats", () => {
  it("returns an empty array for no translations", () => {
    expect(computeLanguageStats([])).toEqual([]);
  });

  it("counts translations per target language, sorted descending by count", () => {
    const translations = [
      { targetLanguage: "zh" },
      { targetLanguage: "es" },
      { targetLanguage: "zh" },
      { targetLanguage: "zh" },
    ];
    expect(computeLanguageStats(translations)).toEqual([
      { language: "zh", translationCount: 3 },
      { language: "es", translationCount: 1 },
    ]);
  });
});

describe("computeConfidenceStats", () => {
  it("returns zeroed stats for no scored translations", () => {
    expect(computeConfidenceStats([])).toEqual({ averagePercent: 0, mediumCount: 0, lowCount: 0, byRootCause: {} });
  });

  it("averages confidence and counts levels/root causes", () => {
    const translations = [
      { confidence: 96, confidenceLevel: "high", rootCause: null },
      { confidence: 48, confidenceLevel: "low", rootCause: "audio" },
      { confidence: 80, confidenceLevel: "medium", rootCause: "terminology" },
    ];
    expect(computeConfidenceStats(translations)).toEqual({
      averagePercent: 75,
      mediumCount: 1,
      lowCount: 1,
      byRootCause: { audio: 1, terminology: 1 },
    });
  });

  it("ignores translations with no recorded confidence", () => {
    const translations = [
      { confidence: null, confidenceLevel: null, rootCause: null },
      { confidence: 90, confidenceLevel: "high", rootCause: null },
    ];
    expect(computeConfidenceStats(translations)).toEqual({ averagePercent: 90, mediumCount: 0, lowCount: 0, byRootCause: {} });
  });

  it("clamps invalid confidence percentages and ignores non-finite values", () => {
    const translations = [
      { confidence: -10, confidenceLevel: "low", rootCause: "audio" },
      { confidence: 120, confidenceLevel: "medium", rootCause: "terminology" },
      { confidence: Number.NaN, confidenceLevel: "low", rootCause: "network" },
      { confidence: Number.POSITIVE_INFINITY, confidenceLevel: "medium", rootCause: "translation" },
    ];

    expect(computeConfidenceStats(translations)).toEqual({
      averagePercent: 50,
      mediumCount: 1,
      lowCount: 1,
      byRootCause: { audio: 1, terminology: 1 },
    });
  });

  it("counts root causes only for medium and low confidence levels", () => {
    const translations = [
      { confidence: 95, confidenceLevel: "high", rootCause: "audio" },
      { confidence: 70, confidenceLevel: "medium", rootCause: "terminology" },
    ];

    expect(computeConfidenceStats(translations)).toEqual({
      averagePercent: 83,
      mediumCount: 1,
      lowCount: 0,
      byRootCause: { terminology: 1 },
    });
  });
});
