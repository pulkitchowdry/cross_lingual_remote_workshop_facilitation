import { SessionStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getDictionary } from "@/lib/i18n";
import type { SupportedLanguage } from "@/lib/session-contracts";
import {
  computeConfusionTrend,
  computeParticipationFromGroups,
  computeBlockerStats,
  computeActiveActionItems,
  computeLanguageStats,
  computeConfidenceStats,
  type FacilitatorAnalytics,
  type ActiveActionItem,
} from "@/lib/facilitator-analytics";
import { facilitatorVisibleSessionMessageWhere } from "@/lib/message-visibility";
import { resolveInsight } from "@/app/sessions/[sessionId]/facilitator/actions";

export interface ActiveActionItemView extends ActiveActionItem {
  resolveAction: () => Promise<void>;
}

export interface FacilitatorAnalyticsLabels {
  analyticsDrawerLabel: string;
  analyticsDrawerOpen: string;
  analyticsDrawerClose: string;
  analyticsConfusionTrendHeading: string;
  analyticsParticipationHeading: string;
  analyticsBlockersHeading: string;
  analyticsLanguagesHeading: string;
  analyticsConfidenceHeading: string;
  analyticsConfusionTrendSummary: string;
  analyticsEmptyState: string;
  analyticsFrozenNotice: string;
  analyticsActNowHeading: string;
  blockerLabel: string;
  confusionLabel: string;
  resolveBlockerLabel: string;
}

export interface FacilitatorAnalyticsView {
  analytics: FacilitatorAnalytics;
  labels: FacilitatorAnalyticsLabels;
  // Precomputed server-side (AnalyticsDrawer/AnalyticsPanelContent are "use client" —
  // RSC can't serialize the dict's formatter functions across that prop boundary).
  // Order matches analytics.participation / analytics.languages 1:1.
  participationRows: string[];
  blockersSummary: string;
  languageRows: string[];
  confidenceSummary: string;
  /** Unresolved BLOCKER/CONFUSION insights ("Act now" queue), each with a bound
   * `resolveInsight` server action — same data the facilitator dashboard's own
   * standalone "Act now" section shows, so a facilitator inside the live meeting room
   * (which never rendered this before) can see and resolve them without leaving the
   * call. See AnalyticsPanelContent's `showActiveActionItems` for where this actually
   * gets rendered vs. just carried on the view model. */
  activeActionItems: ActiveActionItemView[];
}

/**
 * Fetches and computes everything AnalyticsDrawer needs, shared by every page a
 * facilitator can occupy during a session — originally only called from
 * facilitator/page.tsx (the dashboard), which meant facilitator/room/page.tsx (the
 * full-page live meeting `startSession` actually redirects into) never rendered any
 * analytics at all for the entire duration of a live workshop. Extracted here so the
 * two pages can't drift out of sync with each other the way they already had.
 */
export async function buildFacilitatorAnalyticsView(
  sessionId: string,
  session: {
    startedAt: Date | null;
    createdAt: Date;
    status: SessionStatus;
    endedAt: Date | null;
    facilitatorId: string;
    sourceLanguage: string;
    participants: { userId: string; user: { displayName: string } }[];
  },
  lang: SupportedLanguage,
): Promise<FacilitatorAnalyticsView> {
  const dict = getDictionary(lang).facilitator;
  const commonDict = getDictionary(lang).common;

  // All unbounded (not sliced from a count-capped `include`, which could silently
  // drop an older-but-still-relevant row once enough newer ones of any type/sender
  // accumulated) — see the matching, more detailed comments in facilitator/page.tsx's
  // own historical version of these same queries.
  const [allBlockerInsights, allMessagesForParticipation, allConfusionInsights, allTranslations, activeActionItemInsights] =
    await Promise.all([
      prisma.insight.findMany({
        where: { sessionId, type: "BLOCKER" },
        select: { status: true, createdAt: true },
      }),
      prisma.message.groupBy({
        by: ["senderId", "kind", "isAnonymous"],
        // Facilitator-visible, not public-only: a learner who also checks "message
        // facilitator privately" alongside "flag as question" produces a message with a
        // non-null recipientId that publicSessionMessageWhere would silently drop from
        // this facilitator-only participation view, even though the facilitator already
        // sees it in their own chat panel. See facilitatorVisibleSessionMessageWhere's
        // own doc comment.
        where: facilitatorVisibleSessionMessageWhere(sessionId, session.facilitatorId),
        _count: true,
      }),
      prisma.insight.findMany({
        where: { sessionId, type: "CONFUSION" },
        select: { createdAt: true },
      }),
      prisma.translation.findMany({
        where: { transcriptSegment: { sessionId } },
        select: { targetLanguage: true, confidence: true, confidenceLevel: true, rootCause: true },
      }),
      // Active BLOCKER/CONFUSION insights ("Act now" queue) — a dedicated, unbounded
      // query rather than sliced from any count-capped list, for the same reason
      // computeBlockerStats' input isn't: an older unresolved item must never silently
      // fall out of view just because enough newer insights of any type accumulated.
      prisma.insight.findMany({
        where: { sessionId, type: { in: ["BLOCKER", "CONFUSION"] }, status: "ACTIVE" },
        include: { evidence: { include: { transcriptSegment: { include: { translations: true } } } } },
        orderBy: { createdAt: "desc" },
      }),
    ]);

  const analytics: FacilitatorAnalytics = {
    confusionTrend: computeConfusionTrend(
      allConfusionInsights.map((item) => item.createdAt),
      session.startedAt ?? session.createdAt,
      session.status === SessionStatus.ENDED ? (session.endedAt ?? new Date()) : new Date(),
      session.participants.length,
    ),
    participation: computeParticipationFromGroups(
      allMessagesForParticipation,
      session.participants.map((p) => ({ userId: p.userId, displayName: p.user.displayName })),
    ),
    blockers: computeBlockerStats(allBlockerInsights.map((item) => ({ ...item, type: "BLOCKER", resolvedAt: null }))),
    languages: computeLanguageStats(allTranslations.map((translation) => ({ targetLanguage: translation.targetLanguage }))),
    confidence: computeConfidenceStats(
      allTranslations.map((translation) => ({
        confidence: translation.confidence,
        confidenceLevel: translation.confidenceLevel,
        rootCause: translation.rootCause,
      })),
    ),
  };

  const levelRank = { CALM: 0, SOME: 1, HIGH: 2 } as const;
  const highestLevel = analytics.confusionTrend.reduce<"CALM" | "SOME" | "HIGH">(
    (highest, point) => (levelRank[point.groupLevel] > levelRank[highest] ? point.groupLevel : highest),
    "CALM",
  );

  const activeActionItems: ActiveActionItemView[] = computeActiveActionItems(
    activeActionItemInsights,
    session.sourceLanguage,
    lang,
    commonDict.translationUnavailable,
  ).map((item) => ({ ...item, resolveAction: resolveInsight.bind(null, sessionId, item.id) }));

  return {
    analytics,
    labels: {
      analyticsDrawerLabel: dict.analyticsDrawerLabel,
      analyticsDrawerOpen: dict.analyticsDrawerOpen,
      analyticsDrawerClose: dict.analyticsDrawerClose,
      analyticsConfusionTrendHeading: dict.analyticsConfusionTrendHeading,
      analyticsParticipationHeading: dict.analyticsParticipationHeading,
      analyticsBlockersHeading: dict.analyticsBlockersHeading,
      analyticsLanguagesHeading: dict.analyticsLanguagesHeading,
      analyticsConfidenceHeading: dict.analyticsConfidenceHeading,
      analyticsConfusionTrendSummary: dict.analyticsConfusionTrendSummary(
        analytics.confusionTrend.length,
        dict.confusionLevelLabel[highestLevel],
      ),
      analyticsEmptyState: dict.analyticsEmptyState,
      analyticsFrozenNotice: dict.analyticsFrozenNotice,
      analyticsActNowHeading: dict.actNow,
      blockerLabel: dict.blocker,
      confusionLabel: dict.confusion,
      resolveBlockerLabel: dict.resolveBlocker,
    },
    participationRows: analytics.participation.map((entry) =>
      dict.analyticsParticipationRow(entry.displayName, entry.messageCount, entry.questionCount, entry.isAnonymousAny),
    ),
    blockersSummary: dict.analyticsBlockersSummary(analytics.blockers.raised, analytics.blockers.resolved, analytics.blockers.open),
    languageRows: analytics.languages.map((entry) => dict.analyticsLanguagesRow(entry.language, entry.translationCount)),
    confidenceSummary: dict.analyticsConfidenceSummary(
      analytics.confidence.averagePercent,
      analytics.confidence.mediumCount,
      analytics.confidence.lowCount,
    ),
    activeActionItems,
  };
}
