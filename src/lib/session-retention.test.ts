import { describe, expect, it } from "vitest";
import { isRetentionExpired, isSessionRetentionExpired, retentionDeadline } from "./session-retention";

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

describe("isSessionRetentionExpired", () => {
  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  const startedAt = new Date("2026-01-02T00:00:00.000Z");

  it("anchors to endedAt when the session has ended", () => {
    const endedAt = new Date("2026-01-10T00:00:00.000Z");
    const justBeforeDeadline = new Date(endedAt.getTime() + 7 * DAY_MS - 1_000);
    const atDeadline = new Date(endedAt.getTime() + 7 * DAY_MS);
    expect(isSessionRetentionExpired({ createdAt, startedAt, endedAt, retentionDays: 7 }, justBeforeDeadline)).toBe(false);
    expect(isSessionRetentionExpired({ createdAt, startedAt, endedAt, retentionDays: 7 }, atDeadline)).toBe(true);
  });

  it("falls back to startedAt for a session that started but never ended, instead of never expiring", () => {
    const justBeforeDeadline = new Date(startedAt.getTime() + 7 * DAY_MS - 1_000);
    const atDeadline = new Date(startedAt.getTime() + 7 * DAY_MS);
    expect(isSessionRetentionExpired({ createdAt, startedAt, endedAt: null, retentionDays: 7 }, justBeforeDeadline)).toBe(
      false,
    );
    expect(isSessionRetentionExpired({ createdAt, startedAt, endedAt: null, retentionDays: 7 }, atDeadline)).toBe(true);
  });

  it("never expires a DRAFT session that was never started, no matter how old createdAt is", () => {
    const wellPastWhatCreatedAtWouldImply = new Date(createdAt.getTime() + 365 * DAY_MS);
    expect(
      isSessionRetentionExpired(
        { createdAt, startedAt: null, endedAt: null, retentionDays: 7 },
        wellPastWhatCreatedAtWouldImply,
      ),
    ).toBe(false);
  });

  it("defaults `now` to the current time", () => {
    expect(isSessionRetentionExpired({ createdAt: new Date(), startedAt: null, endedAt: null, retentionDays: 30 })).toBe(
      false,
    );
  });
});
