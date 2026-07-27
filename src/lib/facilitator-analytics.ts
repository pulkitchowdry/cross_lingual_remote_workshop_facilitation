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

export interface ConfidenceStats {
  /** 0-100, rounded — omits translations with no confidence recorded (e.g. pre-migration rows). */
  averagePercent: number;
  mediumCount: number;
  lowCount: number;
  /** Counts by root cause, only for Medium/Low translations that have one. */
  byRootCause: Record<string, number>;
}

export interface FacilitatorAnalytics {
  confusionTrend: ConfusionTrendPoint[];
  participation: ParticipationEntry[];
  blockers: BlockerStats;
  languages: LanguageStat[];
  confidence: ConfidenceStats;
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

/** Same output as `computeParticipation`, but sourced from a Prisma `groupBy`
 * (`{senderId, kind, isAnonymous}` + `_count`) instead of one row per message —
 * avoids ever materializing a flat per-message array for a 2s-polled query. */
export function computeParticipationFromGroups(
  groups: { senderId: string; kind: string; isAnonymous: boolean; _count: number }[],
  participants: { userId: string; displayName: string }[],
): ParticipationEntry[] {
  const byUser = new Map<string, ParticipationEntry>(
    participants.map((p) => [p.userId, { userId: p.userId, displayName: p.displayName, messageCount: 0, questionCount: 0, isAnonymousAny: false }]),
  );

  for (const group of groups) {
    const entry = byUser.get(group.senderId);
    if (!entry) continue;
    entry.messageCount += group._count;
    if (group.kind === "QUESTION") entry.questionCount += group._count;
    if (group.isAnonymous && group._count > 0) entry.isAnonymousAny = true;
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

/** Post-meeting Confidence Score metrics (issue #130's "Post-Meeting Metrics") —
 * average score plus how many translations needed attention and why, so a
 * facilitator can see e.g. "audio issues were the biggest problem this
 * session" without re-reading the whole transcript. */
export function computeConfidenceStats(
  translations: { confidence: number | null; confidenceLevel: string | null; rootCause: string | null }[],
): ConfidenceStats {
  const scored = translations.filter((t): t is { confidence: number; confidenceLevel: string | null; rootCause: string | null } => t.confidence != null);
  const averagePercent =
    scored.length === 0 ? 0 : Math.round(scored.reduce((sum, t) => sum + t.confidence, 0) / scored.length);
  const byRootCause: Record<string, number> = {};
  let mediumCount = 0;
  let lowCount = 0;
  for (const translation of scored) {
    if (translation.confidenceLevel === "medium") mediumCount += 1;
    if (translation.confidenceLevel === "low") lowCount += 1;
    if (translation.rootCause) byRootCause[translation.rootCause] = (byRootCause[translation.rootCause] ?? 0) + 1;
  }
  return { averagePercent, mediumCount, lowCount, byRootCause };
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
