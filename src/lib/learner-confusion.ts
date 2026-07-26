const DEFAULT_WINDOW_MS = 10 * 60 * 1000;

export type LearnerConfusionLevel = "SOME" | "HIGH";

export interface LearnerConfusionEntry {
  userId: string;
  level: LearnerConfusionLevel;
  count: number;
}

/**
 * Per-learner counterpart to computeConfusionLevel (src/lib/confusion-level.ts):
 * same rolling window and thresholds, but grouped by sender instead of
 * session-wide, over QUESTION messages from CaptionComprehensionActions
 * ("Explain simply" / "Give an example") rather than inferred CONFUSION
 * insights — TranscriptSegment.speakerId can't attribute those to a learner
 * (see design doc), but a learner explicitly asking for clarification can.
 */
export function computeLearnerConfusionLevels(
  questionMessages: { senderId: string; sentAt: Date }[],
  learnerUserIds: ReadonlySet<string>,
  now: Date,
  windowMs: number = DEFAULT_WINDOW_MS,
): LearnerConfusionEntry[] {
  const counts = new Map<string, number>();

  for (const message of questionMessages) {
    if (!learnerUserIds.has(message.senderId)) continue;
    const age = now.getTime() - message.sentAt.getTime();
    if (age < 0 || age > windowMs) continue;
    counts.set(message.senderId, (counts.get(message.senderId) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([userId, count]) => ({ userId, count, level: (count <= 2 ? "SOME" : "HIGH") as LearnerConfusionLevel }))
    .sort((a, b) => b.count - a.count);
}
