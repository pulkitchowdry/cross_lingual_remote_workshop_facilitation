import { describe, expect, it } from "vitest";
import { computeConfusionLevel } from "@/lib/confusion-level";

const NOW = new Date("2026-07-26T12:00:00.000Z");
const WINDOW_MS = 10 * 60 * 1000;
/** A small class where the ratio-based HIGH threshold never becomes the limiting
 * factor for these counts (matches this suite's pre-normalization expectations). */
const SMALL_CLASS = 5;

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
}

describe("computeConfusionLevel", () => {
  it("returns CALM with count 0 for an empty list", () => {
    expect(computeConfusionLevel([], SMALL_CLASS, NOW)).toEqual({ level: "CALM", count: 0 });
  });

  it("returns SOME for 1 timestamp inside the window", () => {
    expect(computeConfusionLevel([minutesAgo(5)], SMALL_CLASS, NOW)).toEqual({ level: "SOME", count: 1 });
  });

  it("returns SOME for 2 timestamps inside the window", () => {
    expect(computeConfusionLevel([minutesAgo(1), minutesAgo(9)], SMALL_CLASS, NOW)).toEqual({ level: "SOME", count: 2 });
  });

  it("returns HIGH for 3 timestamps inside the window in a small class", () => {
    expect(computeConfusionLevel([minutesAgo(1), minutesAgo(2), minutesAgo(3)], SMALL_CLASS, NOW)).toEqual({
      level: "HIGH",
      count: 3,
    });
  });

  it("returns HIGH for more than 3 timestamps inside the window in a small class", () => {
    expect(
      computeConfusionLevel(
        [minutesAgo(1), minutesAgo(2), minutesAgo(3), minutesAgo(4), minutesAgo(5)],
        SMALL_CLASS,
        NOW,
      ),
    ).toEqual({ level: "HIGH", count: 5 });
  });

  it("includes a timestamp exactly at the window boundary", () => {
    const exactlyAtEdge = new Date(NOW.getTime() - WINDOW_MS);
    expect(computeConfusionLevel([exactlyAtEdge], SMALL_CLASS, NOW)).toEqual({ level: "SOME", count: 1 });
  });

  it("excludes a timestamp just outside the window boundary", () => {
    const justOutside = new Date(NOW.getTime() - WINDOW_MS - 1);
    expect(computeConfusionLevel([justOutside], SMALL_CLASS, NOW)).toEqual({ level: "CALM", count: 0 });
  });

  it("excludes timestamps in the future relative to now", () => {
    const future = new Date(NOW.getTime() + 60_000);
    expect(computeConfusionLevel([future], SMALL_CLASS, NOW)).toEqual({ level: "CALM", count: 0 });
  });

  it("counts only in-window timestamps from a mixed list", () => {
    expect(computeConfusionLevel([minutesAgo(1), minutesAgo(20), minutesAgo(3)], SMALL_CLASS, NOW)).toEqual({
      level: "SOME",
      count: 2,
    });
  });

  it("respects a custom windowMs override", () => {
    expect(computeConfusionLevel([minutesAgo(4)], SMALL_CLASS, NOW, 3 * 60 * 1000)).toEqual({ level: "CALM", count: 0 });
  });

  it("does not escalate to HIGH in a large class at the same low confusion rate that would be HIGH in a small one", () => {
    // 3 distinct confused learners out of 20 (15%) reads as an ordinary rate, not an
    // urgent one — the same raw count of 3 that's HIGH for a 5-person class above.
    expect(
      computeConfusionLevel([minutesAgo(1), minutesAgo(2), minutesAgo(3)], 20, NOW),
    ).toEqual({ level: "SOME", count: 3 });
  });

  it("still escalates to HIGH in a large class once the fraction confused is genuinely high", () => {
    // 8 out of 20 (40%) is a large enough fraction to warrant HIGH regardless of class size.
    const timestamps = Array.from({ length: 8 }, (_, i) => minutesAgo(i + 1));
    expect(computeConfusionLevel(timestamps, 20, NOW)).toEqual({ level: "HIGH", count: 8 });
  });
});
