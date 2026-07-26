export type ConfusionLevel = "CALM" | "SOME" | "HIGH";

/** Exported so callers that pre-filter data by time before it ever reaches this
 * function (e.g. a DB query bounding how much history to fetch in the first
 * place) can use the exact same window instead of a second, easily-drifting
 * hardcoded copy of "10 minutes". learner-confusion.ts reuses this too. */
export const DEFAULT_WINDOW_MS = 10 * 60 * 1000;

/**
 * Derives a glanceable group-confusion signal from the timestamps of
 * CONFUSION insights the existing insight pipeline already generates
 * (see src/lib/insights.ts) — no new LLM call, no new data source.
 * Both ACTIVE and RESOLVED CONFUSION insights count: resolution means the
 * facilitator responded, not that the confusion didn't happen.
 */
export function computeConfusionLevel(
  confusionInsightTimestamps: Date[],
  now: Date,
  windowMs: number = DEFAULT_WINDOW_MS,
): { level: ConfusionLevel; count: number } {
  const count = confusionInsightTimestamps.filter((timestamp) => {
    const age = now.getTime() - timestamp.getTime();
    return age >= 0 && age <= windowMs;
  }).length;

  if (count === 0) return { level: "CALM", count };
  if (count <= 2) return { level: "SOME", count };
  return { level: "HIGH", count };
}
