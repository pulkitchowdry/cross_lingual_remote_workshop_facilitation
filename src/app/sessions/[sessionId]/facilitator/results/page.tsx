import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { AnalyticsPanelContent } from "@/components/AnalyticsDrawer";
import { SyncUiLanguage } from "@/components/SyncUiLanguage";
import { SessionAutoRefresh } from "@/components/SessionAutoRefresh";
import { ParticipantRole, SessionStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { buildFacilitatorAnalyticsView } from "@/lib/facilitator-analytics-view";
import { getDictionary, resolveLanguage } from "@/lib/i18n";
import { hasFacilitatorAccess } from "@/lib/session-access";
import { isSessionRetentionExpired } from "@/lib/session-retention";
import { facilitatorVisibleSessionMessageWhere } from "@/lib/message-visibility";
import { insightProvider } from "@/lib/providers/insight";

export const metadata: Metadata = { title: "Session results" };

const POST_SESSION_SUMMARY_GRACE_MS = 30_000;

export default async function FacilitatorSessionResultsPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  if (!(await hasFacilitatorAccess(sessionId))) redirect("/setup");

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      participants: { where: { role: ParticipantRole.LEARNER }, include: { user: true }, orderBy: { joinedAt: "asc" } },
      insights: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!session) notFound();
  if (isSessionRetentionExpired(session)) notFound();

  // Facilitator-visible, not public-only — a learner who also checks "message
  // facilitator privately" alongside "flag as question" produces a message the
  // facilitator already sees in their own chat panel; these summary counts shouldn't
  // silently undercount it. Depends on `session.facilitatorId`, so this can't run in
  // the same Promise.all as the session fetch above.
  const [messageCount, questionCount] = await Promise.all([
    prisma.message.count({ where: facilitatorVisibleSessionMessageWhere(sessionId, session.facilitatorId) }),
    prisma.message.count({ where: { ...facilitatorVisibleSessionMessageWhere(sessionId, session.facilitatorId), kind: "QUESTION" } }),
  ]);

  const lang = resolveLanguage(session.sourceLanguage);
  const dict = getDictionary(lang).facilitator;
  const dashboardHref = `/sessions/${sessionId}/facilitator`;
  const statusLabel = {
    [SessionStatus.DRAFT]: dict.statusDraft,
    [SessionStatus.LIVE]: dict.statusLive,
    [SessionStatus.ENDED]: dict.statusEnded,
  }[session.status];
  const dateTimeFormatter = new Intl.DateTimeFormat(lang, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const recentlyEnded =
    session.status === SessionStatus.ENDED &&
    session.endedAt !== null &&
    new Date().getTime() - session.endedAt.getTime() < POST_SESSION_SUMMARY_GRACE_MS;
  const durationMinutes =
    session.startedAt && session.endedAt
      ? Math.max(0, Math.round((session.endedAt.getTime() - session.startedAt.getTime()) / 60_000))
      : null;
  const misunderstoodTopics = session.insights
    .filter((item) => item.type === "CONFUSION")
    .slice(0, 5)
    .map((item) => ({ id: item.id, summary: item.summary }));

  const analyticsView =
    session.status === SessionStatus.ENDED ? await buildFacilitatorAnalyticsView(sessionId, session, lang) : null;

  return (
    <div className="flex flex-col gap-6">
      <SyncUiLanguage lang={lang} />
      {recentlyEnded && <SessionAutoRefresh durationMs={POST_SESSION_SUMMARY_GRACE_MS} />}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-3" aria-live="polite">
            <h1 className="font-heading text-2xl font-semibold">{dict.sessionResultsHeading}</h1>
            <span
              className="font-data rounded-full border border-border-strong px-2.5 py-1 text-xs font-medium uppercase tracking-wider text-muted-foreground"
            >
              {statusLabel}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">{dict.sessionResultsSummary}</p>
        </div>
        <Link
          href={dashboardHref}
          className="font-data rounded-md border border-border-strong px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-foreground hover:border-accent hover:text-accent"
        >
          {dict.returnToDashboard}
        </Link>
      </div>

      {session.status !== SessionStatus.ENDED ? (
        <Card eyebrow={dict.resultsNotReadyHeading}>
          <p className="text-muted-foreground">{dict.resultsNotReadySummary}</p>
        </Card>
      ) : (
        <>
          <Card eyebrow={dict.sessionResultsCardEyebrow} title={session.title} accent="var(--tick-high)">
            <p className="text-muted-foreground">{dict.sessionResultsSummary}</p>
          </Card>

          <Card eyebrow={dict.basicSessionInfo}>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-data text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {dict.sessionGoal}
                </dt>
                <dd>{session.goal}</dd>
              </div>
              <div>
                <dt className="font-data text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {dict.learnersJoinedHint}
                </dt>
                <dd>{dict.learnersJoinedLabel(session.participants.length)}</dd>
              </div>
              {session.startedAt && (
                <div>
                  <dt className="font-data text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    {dict.sessionStartedAt}
                  </dt>
                  <dd>{dateTimeFormatter.format(session.startedAt)}</dd>
                </div>
              )}
              {session.endedAt && (
                <div>
                  <dt className="font-data text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    {dict.sessionEndedAt}
                  </dt>
                  <dd>{dateTimeFormatter.format(session.endedAt)}</dd>
                </div>
              )}
            </dl>
          </Card>

          <Card eyebrow={dict.sessionSummaryHeading}>
            <p className="font-data text-xs text-muted-foreground">
              {durationMinutes !== null && `${dict.sessionSummaryDuration(durationMinutes)} · `}
              {messageCount} {dict.sessionSummaryMessages.toLowerCase()} · {questionCount}{" "}
              {dict.sessionSummaryQuestions.toLowerCase()}
            </p>
            {misunderstoodTopics.length > 0 && (
              <div className="mt-2">
                <p className="font-data text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {dict.sessionSummaryMisunderstoodTopics}
                </p>
                <ul className="mt-1 list-inside list-disc text-sm">
                  {misunderstoodTopics.map((topic) => (
                    <li key={topic.id}>{topic.summary}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-2 border-t border-border-subtle pt-2">
              {session.summary ? (
                <p className="whitespace-pre-wrap">{session.summary}</p>
              ) : (
                <p className="text-muted-foreground">
                  {!insightProvider.isConfigured
                    ? dict.insightsNotConfigured
                    : recentlyEnded
                      ? dict.sessionSummaryPending
                      : dict.sessionSummaryUnavailable}
                </p>
              )}
            </div>
          </Card>

          {analyticsView && (
            <section className="flex flex-col gap-3">
              <h2 className="font-data text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {dict.analyticsDrawerLabel}
              </h2>
              <AnalyticsPanelContent
                analytics={analyticsView.analytics}
                isFrozen={true}
                labels={analyticsView.labels}
                participationRows={analyticsView.participationRows}
                blockersSummary={analyticsView.blockersSummary}
                languageRows={analyticsView.languageRows}
                confidenceSummary={analyticsView.confidenceSummary}
              />
            </section>
          )}
        </>
      )}
    </div>
  );
}
