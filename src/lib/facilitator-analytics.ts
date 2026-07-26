import { DEFAULT_WINDOW_MS } from "@/lib/confusion-level";

export interface ConfusionTrendPoint {
  bucketStart: Date;
  groupLevel: "CALM" | "SOME" | "HIGH";
  count: number;
}

export interface ParticipationEntry {
  userId: string;
  displayName: string;
  messageCount: number;
  questionCount: number;
  isAnonymousAny: boolean;
}

export interface BlockerStats {
  raised: number;
  resolved: number;
  open: number;
  avgResolutionMs: number | null;
}

export interface LanguageStat {
  language: string;
  translationCount: number;
}

export interface FacilitatorAnalytics {
  confusionTrend: ConfusionTrendPoint[];
  participation: ParticipationEntry[];
  blockers: BlockerStats;
  languages: LanguageStat[];
}

function levelForCount(count: number): "CALM" | "SOME" | "HIGH" {
  if (count === 0) return "CALM";
  if (count <= 2) return "SOME";
  return "HIGH";
}

/**
 * Buckets CONFUSION insight timestamps into fixed `bucketMs`-wide windows from
 * `sessionStart` to `now`, reusing the same per-bucket thresholds as
 * computeConfusionLevel (confusion-level.ts) rather than a second scale.
 */
export function computeConfusionTrend(
  confusionInsightTimestamps: Date[],
  sessionStart: Date,
  now: Date,
  bucketMs: number = DEFAULT_WINDOW_MS,
): ConfusionTrendPoint[] {
  const totalMs = Math.max(0, now.getTime() - sessionStart.getTime());
  const bucketCount = Math.max(1, Math.ceil(totalMs / bucketMs));
  const buckets: ConfusionTrendPoint[] = Array.from({ length: bucketCount }, (_, i) => ({
    bucketStart: new Date(sessionStart.getTime() + i * bucketMs),
    groupLevel: "CALM" as const,
    count: 0,
  }));

  for (const timestamp of confusionInsightTimestamps) {
    const offset = timestamp.getTime() - sessionStart.getTime();
    if (offset < 0) continue;
    const index = Math.min(bucketCount - 1, Math.floor(offset / bucketMs));
    buckets[index].count += 1;
  }

  return buckets.map((bucket) => ({ ...bucket, groupLevel: levelForCount(bucket.count) }));
}

/** Per-learner message/question totals over the whole session, for every known
 * participant (zero-filled) — not time-windowed, unlike the live confusion badges. */
export function computeParticipation(
  messages: { senderId: string; kind: string; isAnonymous: boolean }[],
  participants: { userId: string; displayName: string }[],
): ParticipationEntry[] {
  const byUser = new Map<string, ParticipationEntry>(
    participants.map((p) => [p.userId, { userId: p.userId, displayName: p.displayName, messageCount: 0, questionCount: 0, isAnonymousAny: false }]),
  );

  for (const message of messages) {
    const entry = byUser.get(message.senderId);
    if (!entry) continue;
    entry.messageCount += 1;
    if (message.kind === "QUESTION") entry.questionCount += 1;
    if (message.isAnonymous) entry.isAnonymousAny = true;
  }

  return Array.from(byUser.values());
}

/**
 * `avgResolutionMs` is always null: Insight has no `resolvedAt` column today
 * (only a plain `status` string set by resolveInsight in facilitator/actions.ts),
 * so time-to-resolution can't be computed yet without a schema change, which is
 * out of scope for this feature.
 */
export function computeBlockerStats(
  insights: { type: string; status: string; createdAt: Date; resolvedAt: Date | null }[],
): BlockerStats {
  const blockerInsights = insights.filter((item) => item.type === "BLOCKER");
  const resolved = blockerInsights.filter((item) => item.status === "RESOLVED").length;
  const raised = blockerInsights.length;
  return { raised, resolved, open: raised - resolved, avgResolutionMs: null };
}

export function computeLanguageStats(translations: { targetLanguage: string }[]): LanguageStat[] {
  const counts = new Map<string, number>();
  for (const translation of translations) {
    counts.set(translation.targetLanguage, (counts.get(translation.targetLanguage) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([language, translationCount]) => ({ language, translationCount }))
    .sort((a, b) => b.translationCount - a.translationCount);
}
