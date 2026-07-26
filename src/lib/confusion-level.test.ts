import { describe, expect, it } from "vitest";
import { computeConfusionLevel } from "@/lib/confusion-level";

const NOW = new Date("2026-07-26T12:00:00.000Z");
const WINDOW_MS = 10 * 60 * 1000;

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
}

describe("computeConfusionLevel", () => {
  it("returns CALM with count 0 for an empty list", () => {
    expect(computeConfusionLevel([], NOW)).toEqual({ level: "CALM", count: 0 });
  });

  it("returns SOME for 1 timestamp inside the window", () => {
    expect(computeConfusionLevel([minutesAgo(5)], NOW)).toEqual({ level: "SOME", count: 1 });
  });

  it("returns SOME for 2 timestamps inside the window", () => {
    expect(computeConfusionLevel([minutesAgo(1), minutesAgo(9)], NOW)).toEqual({ level: "SOME", count: 2 });
  });

  it("returns HIGH for 3 timestamps inside the window", () => {
    expect(computeConfusionLevel([minutesAgo(1), minutesAgo(2), minutesAgo(3)], NOW)).toEqual({
      level: "HIGH",
      count: 3,
    });
  });

  it("returns HIGH for more than 3 timestamps inside the window", () => {
    expect(
      computeConfusionLevel([minutesAgo(1), minutesAgo(2), minutesAgo(3), minutesAgo(4), minutesAgo(5)], NOW),
    ).toEqual({ level: "HIGH", count: 5 });
  });

  it("includes a timestamp exactly at the window boundary", () => {
    const exactlyAtEdge = new Date(NOW.getTime() - WINDOW_MS);
    expect(computeConfusionLevel([exactlyAtEdge], NOW)).toEqual({ level: "SOME", count: 1 });
  });

  it("excludes a timestamp just outside the window boundary", () => {
    const justOutside = new Date(NOW.getTime() - WINDOW_MS - 1);
    expect(computeConfusionLevel([justOutside], NOW)).toEqual({ level: "CALM", count: 0 });
  });

  it("excludes timestamps in the future relative to now", () => {
    const future = new Date(NOW.getTime() + 60_000);
    expect(computeConfusionLevel([future], NOW)).toEqual({ level: "CALM", count: 0 });
  });

  it("counts only in-window timestamps from a mixed list", () => {
    expect(computeConfusionLevel([minutesAgo(1), minutesAgo(20), minutesAgo(3)], NOW)).toEqual({
      level: "SOME",
      count: 2,
    });
  });

  it("respects a custom windowMs override", () => {
    expect(computeConfusionLevel([minutesAgo(4)], NOW, 3 * 60 * 1000)).toEqual({ level: "CALM", count: 0 });
  });
});
