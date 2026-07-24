import { describe, expect, it } from "vitest";
import { isRetentionExpired, retentionDeadline } from "./session-retention";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("retentionDeadline", () => {
  it("adds retentionDays to the session's end time", () => {
    const endedAt = new Date("2026-01-01T00:00:00.000Z");
    expect(retentionDeadline(endedAt, 7).getTime()).toBe(endedAt.getTime() + 7 * DAY_MS);
  });

  it("supports a same-day (0 day) retention window", () => {
    const endedAt = new Date("2026-01-01T00:00:00.000Z");
    expect(retentionDeadline(endedAt, 0).getTime()).toBe(endedAt.getTime());
  });
});

describe("isRetentionExpired", () => {
  const endedAt = new Date("2026-01-01T00:00:00.000Z");

  it("is not expired before the deadline", () => {
    const justBefore = new Date(endedAt.getTime() + 7 * DAY_MS - 1_000);
    expect(isRetentionExpired(endedAt, 7, justBefore)).toBe(false);
  });

  it("is expired exactly at the deadline", () => {
    const atDeadline = new Date(endedAt.getTime() + 7 * DAY_MS);
    expect(isRetentionExpired(endedAt, 7, atDeadline)).toBe(true);
  });

  it("is expired well after the deadline", () => {
    const wellAfter = new Date(endedAt.getTime() + 30 * DAY_MS);
    expect(isRetentionExpired(endedAt, 7, wellAfter)).toBe(true);
  });
});
