export type ConfusionLevel = "CALM" | "SOME" | "HIGH";

/** Exported so callers that pre-filter data by time before it ever reaches this
 * function (e.g. a DB query bounding how much history to fetch in the first
 * place) can use the exact same window instead of a second, easily-drifting
 * hardcoded copy of "10 minutes". learner-confusion.ts reuses this too. */
export const DEFAULT_WINDOW_MS = 10 * 60 * 1000;

/** Above this fraction of the class showing distinct confusion within the window,
 * the signal escalates to HIGH regardless of class size. */
const HIGH_CONFUSION_RATIO = 0.2;

/**
 * Shared CALM/SOME/HIGH threshold for a raw count of CONFUSION-insight
 * occurrences within a window — used by both computeConfusionLevel below (the
 * live badge) and facilitator-analytics.ts's confusion trend (the post-session
 * chart), so the two can't drift into two different notions of "confused".
 *
 * `count <= 2` is a flat floor kept regardless of class size — a couple of
 * distinct confused remarks is a real signal worth "SOME" even in a huge
 * class, not just noise. Above that floor, HIGH requires the count to be a
 * genuinely large *fraction* of the class, not just a fixed absolute number:
 * each CONFUSION insight is typically triggered by a distinct learner's
 * confused remark, so a raw count scales with class size for a constant
 * per-learner confusion rate — an absolute-count-only threshold (the original
 * behavior) made a 20-learner class read as HIGH from the same, entirely
 * ordinary confusion rate that left a 3-learner class at SOME or CALM.
 */
export function levelForCount(count: number, participantCount: number): ConfusionLevel {
  if (count === 0) return "CALM";
  if (count <= 2) return "SOME";
  const ratio = participantCount > 0 ? count / participantCount : 1;
  return ratio > HIGH_CONFUSION_RATIO ? "HIGH" : "SOME";
}

/**
 * Derives a glanceable group-confusion signal from the timestamps of
 * CONFUSION insights the existing insight pipeline already generates
 * (see src/lib/insights.ts) — no new LLM call, no new data source.
 * Both ACTIVE and RESOLVED CONFUSION insights count: resolution means the
 * facilitator responded, not that the confusion didn't happen.
 */
export function computeConfusionLevel(
  confusionInsightTimestamps: Date[],
  participantCount: number,
  now: Date,
  windowMs: number = DEFAULT_WINDOW_MS,
): { level: ConfusionLevel; count: number } {
  const count = confusionInsightTimestamps.filter((timestamp) => {
    const age = now.getTime() - timestamp.getTime();
    return age >= 0 && age <= windowMs;
  }).length;

  return { level: levelForCount(count, participantCount), count };
}
