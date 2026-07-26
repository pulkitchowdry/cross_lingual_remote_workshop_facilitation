import { describe, expect, it } from "vitest";
import {
  computeConfusionTrend,
  computeParticipation,
  computeBlockerStats,
  computeLanguageStats,
} from "@/lib/facilitator-analytics";

const NOW = new Date("2026-07-26T12:00:00.000Z");
const SESSION_START = new Date("2026-07-26T11:40:00.000Z"); // 20 min before NOW
const BUCKET_MS = 10 * 60 * 1000;

function minutesAfterStart(minutes: number): Date {
  return new Date(SESSION_START.getTime() + minutes * 60 * 1000);
}

describe("computeConfusionTrend", () => {
  it("returns one CALM bucket per bucketMs-sized window from sessionStart to now, with no data", () => {
    const result = computeConfusionTrend([], SESSION_START, NOW, BUCKET_MS);
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
    const result = computeConfusionTrend(timestamps, SESSION_START, NOW, BUCKET_MS);
    expect(result[0]).toEqual({ bucketStart: SESSION_START, groupLevel: "HIGH", count: 3 });
    expect(result[1].count).toBe(0);
  });

  it("returns a single bucket when sessionStart equals now", () => {
    const result = computeConfusionTrend([], NOW, NOW, BUCKET_MS);
    expect(result).toEqual([{ bucketStart: NOW, groupLevel: "CALM", count: 0 }]);
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
