import { describe, expect, it } from "vitest";
import { computeLearnerConfusionLevels } from "@/lib/learner-confusion";

const NOW = new Date("2026-07-26T12:00:00.000Z");
const WINDOW_MS = 10 * 60 * 1000;
const LEARNERS = new Set(["learner-a", "learner-b"]);

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
}

describe("computeLearnerConfusionLevels", () => {
  it("returns an empty array for no messages", () => {
    expect(computeLearnerConfusionLevels([], LEARNERS, NOW)).toEqual([]);
  });

  it("returns SOME for a learner with 1 question in the window", () => {
    expect(
      computeLearnerConfusionLevels([{ senderId: "learner-a", sentAt: minutesAgo(2) }], LEARNERS, NOW),
    ).toEqual([{ userId: "learner-a", level: "SOME", count: 1 }]);
  });

  it("returns HIGH for a learner with 3 questions in the window", () => {
    const messages = [
      { senderId: "learner-a", sentAt: minutesAgo(1) },
      { senderId: "learner-a", sentAt: minutesAgo(2) },
      { senderId: "learner-a", sentAt: minutesAgo(3) },
    ];
    expect(computeLearnerConfusionLevels(messages, LEARNERS, NOW)).toEqual([
      { userId: "learner-a", level: "HIGH", count: 3 },
    ]);
  });

  it("returns entries for multiple learners sorted by count descending", () => {
    const messages = [
      { senderId: "learner-a", sentAt: minutesAgo(1) },
      { senderId: "learner-b", sentAt: minutesAgo(1) },
      { senderId: "learner-b", sentAt: minutesAgo(2) },
      { senderId: "learner-b", sentAt: minutesAgo(3) },
    ];
    expect(computeLearnerConfusionLevels(messages, LEARNERS, NOW)).toEqual([
      { userId: "learner-b", level: "HIGH", count: 3 },
      { userId: "learner-a", level: "SOME", count: 1 },
    ]);
  });

  it("excludes messages from a senderId not in learnerUserIds", () => {
    const messages = [
      { senderId: "learner-a", sentAt: minutesAgo(1) },
      { senderId: "facilitator-1", sentAt: minutesAgo(1) },
    ];
    expect(computeLearnerConfusionLevels(messages, LEARNERS, NOW)).toEqual([
      { userId: "learner-a", level: "SOME", count: 1 },
    ]);
  });

  it("includes a message exactly at the window boundary", () => {
    const exactlyAtEdge = new Date(NOW.getTime() - WINDOW_MS);
    expect(
      computeLearnerConfusionLevels([{ senderId: "learner-a", sentAt: exactlyAtEdge }], LEARNERS, NOW),
    ).toEqual([{ userId: "learner-a", level: "SOME", count: 1 }]);
  });

  it("excludes a message just outside the window boundary", () => {
    const justOutside = new Date(NOW.getTime() - WINDOW_MS - 1);
    expect(
      computeLearnerConfusionLevels([{ senderId: "learner-a", sentAt: justOutside }], LEARNERS, NOW),
    ).toEqual([]);
  });

  it("excludes messages in the future relative to now", () => {
    const future = new Date(NOW.getTime() + 60_000);
    expect(computeLearnerConfusionLevels([{ senderId: "learner-a", sentAt: future }], LEARNERS, NOW)).toEqual([]);
  });

  it("respects a custom windowMs override", () => {
    expect(
      computeLearnerConfusionLevels([{ senderId: "learner-a", sentAt: minutesAgo(4) }], LEARNERS, NOW, 3 * 60 * 1000),
    ).toEqual([]);
  });
});
