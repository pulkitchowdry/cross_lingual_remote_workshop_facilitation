import type { Metadata } from "next";
import Link from "next/link";
import QRCode from "qrcode";
import { Card } from "@/components/ui/Card";
import type { TranscriptFeedEntry } from "@/components/LiveTranscriptFeed";
import { SessionAutoRefresh } from "@/components/SessionAutoRefresh";
import { SessionSidePanel } from "@/components/SessionSidePanel";
import { TranslatedAudioPlayer } from "@/components/TranslatedAudioPlayer";
import { SyncUiLanguage } from "@/components/SyncUiLanguage";
import { LanguageMenu } from "@/components/LanguageMenu";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ParticipantRole, SessionStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { learnerInviteCookieName } from "@/lib/session-security";
import { hasFacilitatorAccess } from "@/lib/session-access";
import { insightProvider } from "@/lib/providers/insight";
import { textToSpeechProvider } from "@/lib/providers/text-to-speech";
import { getDictionary, resolveLanguage } from "@/lib/i18n";
import { INSIGHT_HISTORY_LIMIT, MESSAGE_HISTORY_LIMIT, TRANSCRIPT_HISTORY_LIMIT } from "@/lib/session-contracts";
import { computeConfusionLevel, DEFAULT_WINDOW_MS as DEFAULT_CONFUSION_WINDOW_MS } from "@/lib/confusion-level";
import { computeLearnerConfusionLevels } from "@/lib/learner-confusion";
import {
  computeConfusionTrend,
  computeParticipationFromGroups,
  computeBlockerStats,
  computeLanguageStats,
  computeConfidenceStats,
  type FacilitatorAnalytics,
} from "@/lib/facilitator-analytics";
import { AnalyticsDrawer } from "@/components/AnalyticsDrawer";
import { ConfidenceBadge } from "@/components/ui/ConfidenceBadge";
import type { RootCause } from "@/lib/confidence";
import { isSessionRetentionExpired } from "@/lib/session-retention";
import { visibleSessionMessageWhere } from "@/lib/message-visibility";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import {
  endSession,
  resolveInsight,
  revokeLearnerInvite,
  startSession,
  updateFacilitatorLanguage,
} from "@/app/sessions/[sessionId]/facilitator/actions";
import { sendChatMessage } from "@/app/sessions/actions";
import { approveGlossarySuggestion, ignoreGlossarySuggestion } from "@/app/sessions/[sessionId]/facilitator/glossary/actions";

export const metadata: Metadata = { title: "Facilitator dashboard" };

/**
 * A caption published right before "End session" starts a background
 * `waitUntil(generateSessionInsights(...))` (captions.ts) that can still be
 * running when the page stops being LIVE. Keep polling for a short grace
 * period past end so that last insight still reaches the dashboard instead
 * of silently requiring a manual reload.
 */
const POST_SESSION_INSIGHT_GRACE_MS = 30_000;

export default async function FacilitatorSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const cookieStore = await cookies();
  if (!(await hasFacilitatorAccess(sessionId))) redirect("/setup");
  const accessSession = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { facilitatorId: true },
  });
  if (!accessSession) notFound();

  // Both queries below are time-bounded (not count-bounded like `session.insights`/
  // `session.messages`) and scoped to exactly the type each confusion signal needs —
  // see the comments at their point of use for why deriving these from the
  // INSIGHT_HISTORY_LIMIT/MESSAGE_HISTORY_LIMIT-capped, type-agnostic lists instead
  // (the previous approach) could silently undercount or hide real confusion.
  const confusionWindowStart = new Date(new Date().getTime() - DEFAULT_CONFUSION_WINDOW_MS);
  // Derived from the same constant confusionWindowStart uses (not a second hardcoded
  // "10"), so the confusion badges' tooltip text below can never drift from the window
  // they're actually computed over.
  const confusionWindowMinutes = DEFAULT_CONFUSION_WINDOW_MS / 60_000;
  const [
    session,
    activeActionItems,
    recentConfusionInsights,
    recentLearnerQuestions,
    messageCount,
    questionCount,
    allBlockerInsights,
    allMessagesForParticipation,
    allConfusionInsights,
    pendingGlossarySuggestions,
  ] = await Promise.all([
    prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        participants: { where: { role: ParticipantRole.LEARNER }, include: { user: true }, orderBy: { joinedAt: "asc" } },
        // A secondary `id` tiebreaker: `startedAt`/`sentAt` are millisecond-precision
        // timestamps, so two rows created within the same millisecond (e.g. several
        // learners' chat messages committing at once) have Postgres-undefined relative
        // order under a single-column sort — without a stable tiebreaker, two tied rows
        // can come back in a different relative order on one 2s poll than the next,
        // visibly swapping position on an auto-refreshing page.
        transcript: {
          include: { translations: true },
          orderBy: [{ startedAt: "desc" }, { id: "desc" }],
          take: TRANSCRIPT_HISTORY_LIMIT,
        },
        insights: {
          include: { evidence: { include: { transcriptSegment: { include: { translations: true } } } } },
          orderBy: { createdAt: "desc" },
          take: INSIGHT_HISTORY_LIMIT,
        },
        messages: {
          where: visibleSessionMessageWhere(sessionId, accessSession.facilitatorId),
          include: { sender: true, translations: true },
          orderBy: [{ sentAt: "desc" }, { id: "desc" }],
          take: MESSAGE_HISTORY_LIMIT,
        },
        joinLinks: { where: { role: ParticipantRole.LEARNER } },
      },
    }),
    // Queried directly, not sliced from the `insights` include above — that include is
    // capped at INSIGHT_HISTORY_LIMIT (50) most-recent insights of ANY type, so an
    // older unresolved BLOCKER/CONFUSION silently fell out of "Act now" as soon as 50
    // newer insights of any kind (activity/decision included) accumulated, even though
    // it was never resolved. Active action items are rare enough by nature (the
    // facilitator is expected to resolve them) that fetching every one, unbounded, is
    // the correct read here. BLOCKER and CONFUSION both belong in "Act now" — an
    // unresolved problem and a sign of misunderstanding are both things the
    // facilitator should notice and respond to live, unlike ACTIVITY/DECISION (see
    // "Current lesson" below), which are informational context, not action items.
    prisma.insight.findMany({
      where: { sessionId, type: { in: ["BLOCKER", "CONFUSION"] }, status: "ACTIVE" },
      include: { evidence: { include: { transcriptSegment: { include: { translations: true } } } } },
      orderBy: { createdAt: "desc" },
    }),
    // Group confusion badge: scoped to exactly CONFUSION and time-bounded to the same
    // window computeConfusionLevel itself uses, instead of deriving it from
    // session.insights (INSIGHT_HISTORY_LIMIT-capped across EVERY insight type) — a
    // burst of ACTIVITY/DECISION insights could otherwise push a genuinely recent
    // CONFUSION insight out of that type-agnostic, count-bounded window.
    prisma.insight.findMany({
      where: { sessionId, type: "CONFUSION", createdAt: { gte: confusionWindowStart } },
      select: { createdAt: true },
    }),
    // Per-learner confusion badges: scoped to exactly QUESTION messages and
    // time-bounded, instead of deriving from session.messages (MESSAGE_HISTORY_LIMIT-
    // capped across every sender and every message kind) — ordinary CHAT traffic from
    // other participants could otherwise push a learner's genuinely recent QUESTION
    // messages out of that window, silently hiding or downgrading their badge.
    prisma.message.findMany({
      where: { sessionId, kind: "QUESTION", sentAt: { gte: confusionWindowStart } },
      select: { senderId: true, sentAt: true },
    }),
    // Plain totals (not the MESSAGE_HISTORY_LIMIT-capped `session.messages` array above) so
    // the post-session participation stats reflect the session's real counts, not just
    // whatever fits in the chat panel's most-recent page.
    prisma.message.count({ where: { sessionId } }),
    prisma.message.count({ where: { sessionId, kind: "QUESTION" } }),
    prisma.insight.findMany({
      where: { sessionId, type: "BLOCKER" },
      select: { status: true, createdAt: true },
    }),
    prisma.message.groupBy({
      by: ["senderId", "kind", "isAnonymous"],
      where: { sessionId },
      _count: true,
    }),
    // Unbounded by time (unlike recentConfusionInsights above, which is scoped to the
    // last DEFAULT_CONFUSION_WINDOW_MS for the live group-confusion gauge) — the
    // confusion *trend* buckets the whole session from start to now, so feeding it a
    // 10-minute-windowed query would leave every earlier bucket permanently empty.
    prisma.insight.findMany({
      where: { sessionId, type: "CONFUSION" },
      select: { createdAt: true },
    }),
    // Post-meeting glossary recommendations (issue #131) — unknown technical terms
    // detected during this session's captions, not yet in the shared glossary.
    prisma.glossarySuggestion.findMany({
      where: { sessionId, status: "PENDING" },
      orderBy: { occurrenceCount: "desc" },
    }),
  ]);
  if (!session) notFound();
  // The hourly cleanup cron (retention/cleanup/route.ts) physically deletes an
  // expired session's data, but nothing stops it being served here in the
  // meantime — up to an hour after its own retention deadline, or indefinitely
  // if the cron never runs (e.g. CRON_SECRET was never set). Treat it as gone
  // as soon as it's due, not just once the delete has actually happened.
  if (isSessionRetentionExpired(session)) notFound();

  // Derived from the dedicated, time-bounded queries above — not from session.insights,
  // which is capped at INSIGHT_HISTORY_LIMIT across every insight type (ACTIVITY/
  // DECISION/BLOCKER/CONFUSION combined) and could silently drop a genuinely recent
  // CONFUSION insight once enough other-typed insights accumulated.
  const confusionTimestamps = recentConfusionInsights.map((item) => item.createdAt);
  const confusionLevel = computeConfusionLevel(confusionTimestamps, new Date());

  // Derived from the dedicated, time-bounded query above — not from session.messages,
  // which is capped at MESSAGE_HISTORY_LIMIT across every sender and message kind and
  // could silently drop a learner's genuinely recent QUESTION messages once enough
  // ordinary CHAT traffic (from any participant) accumulated in between.
  const learnerUserIds = new Set(session.participants.map((participant) => participant.userId));
  const learnerConfusionLevels = computeLearnerConfusionLevels(recentLearnerQuestions, learnerUserIds, new Date());
  const learnerDisplayNames = new Map(
    session.participants.map((participant) => [participant.userId, participant.user.displayName]),
  );

  const analytics: FacilitatorAnalytics = {
    // Fed allConfusionInsights (unbounded), not confusionTimestamps (10-minute-windowed,
    // used only for the live gauge above) — and once the session has ended, `now` is
    // pinned to session.endedAt so the trend stops growing empty buckets on every
    // subsequent page load.
    confusionTrend: computeConfusionTrend(
      allConfusionInsights.map((item) => item.createdAt),
      session.startedAt ?? session.createdAt,
      session.status === SessionStatus.ENDED ? (session.endedAt ?? new Date()) : new Date(),
    ),
    participation: computeParticipationFromGroups(
      allMessagesForParticipation,
      session.participants.map((p) => ({ userId: p.userId, displayName: p.user.displayName })),
    ),
    blockers: computeBlockerStats(
      allBlockerInsights.map((item) => ({ ...item, type: "BLOCKER", resolvedAt: null })),
    ),
    languages: computeLanguageStats(
      session.transcript.flatMap((segment) => segment.translations.map((t) => ({ targetLanguage: t.targetLanguage }))),
    ),
    confidence: computeConfidenceStats(
      session.transcript.flatMap((segment) =>
        segment.translations.map((t) => ({ confidence: t.confidence, confidenceLevel: t.confidenceLevel, rootCause: t.rootCause })),
      ),
    ),
  };

  const lang = resolveLanguage(session.sourceLanguage);
  const dict = getDictionary(lang).facilitator;
  const commonDict = getDictionary(lang).common;
  // AnalyticsDrawer is a "use client" component — RSC cannot serialize functions across
  // that prop boundary, so the formatter functions on `dict` (analyticsParticipationRow/
  // analyticsBlockersSummary/analyticsLanguagesRow) must be called here, server-side, and
  // only their plain-string return values passed down. Computed once and reused at both
  // AnalyticsDrawer render sites below (LIVE and ENDED) rather than duplicated.
  const analyticsLabels = {
    analyticsDrawerLabel: dict.analyticsDrawerLabel,
    analyticsDrawerOpen: dict.analyticsDrawerOpen,
    analyticsDrawerClose: dict.analyticsDrawerClose,
    analyticsConfusionTrendHeading: dict.analyticsConfusionTrendHeading,
    analyticsParticipationHeading: dict.analyticsParticipationHeading,
    analyticsBlockersHeading: dict.analyticsBlockersHeading,
    analyticsLanguagesHeading: dict.analyticsLanguagesHeading,
    analyticsConfidenceHeading: dict.analyticsConfidenceHeading,
    analyticsEmptyState: dict.analyticsEmptyState,
    analyticsFrozenNotice: dict.analyticsFrozenNotice,
  };
  const analyticsParticipationRows = analytics.participation.map((entry) =>
    dict.analyticsParticipationRow(entry.displayName, entry.messageCount, entry.questionCount, entry.isAnonymousAny),
  );
  const analyticsBlockersSummary = dict.analyticsBlockersSummary(
    analytics.blockers.raised,
    analytics.blockers.resolved,
    analytics.blockers.open,
  );
  const analyticsLanguageRows = analytics.languages.map((entry) =>
    dict.analyticsLanguagesRow(entry.language, entry.translationCount),
  );
  const analyticsConfidenceSummary = dict.analyticsConfidenceSummary(
    analytics.confidence.averagePercent,
    analytics.confidence.mediumCount,
    analytics.confidence.lowCount,
  );
  const timeFormatter = new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" });
  // session.transcript is fetched newest-first (`orderBy: startedAt desc`, see the query
  // above) so `take: TRANSCRIPT_HISTORY_LIMIT` keeps the N *most recent* segments — but
  // that leaves the JS array itself newest-first too. Reversed here to chronological
  // (oldest-first) order before mapping: LiveTranscriptFeed renders `entries` top-to-bottom
  // and auto-scrolls to the *bottom* on growth (its own doc comment: "newest at the
  // bottom", matching a live chat). Left un-reversed, the feed would show the newest
  // caption at the top instead of the bottom — a confusing ordering glitch confirmed
  // live before this reverse was added.
  const transcriptEntries: TranscriptFeedEntry[] = [...session.transcript].reverse().map((segment) => {
    // Segments used to always be facilitator-authored (always in sourceLanguage), but
    // learners can now type captions too, in their own preferredLanguage — so this can no
    // longer just show originalText and assume it's already the facilitator's language.
    const isSourceLanguage = segment.language === session.sourceLanguage;
    const translation = segment.translations.find((item) => item.targetLanguage === session.sourceLanguage);
    const primaryText = isSourceLanguage ? segment.originalText : (translation?.text ?? commonDict.translationUnavailable);
    const primaryLang = isSourceLanguage ? segment.language : translation ? session.sourceLanguage : "en";
    // For the facilitator's own speech (isSourceLanguage), there's no single "the"
    // translation to show a score for — this shows the *worst* of every language it
    // went out in, so a facilitator sees at a glance if any audience got a low-
    // confidence version (issue #130's "Speaker" UI section). For a learner-authored
    // segment translated back to the facilitator's language, it's just that one
    // translation's own score, same as the learner-facing feed.
    const scoredTranslation = isSourceLanguage
      ? segment.translations.reduce<(typeof segment.translations)[number] | null>((worst, item) => {
          if (item.confidence == null) return worst;
          if (!worst || item.confidence < worst.confidence!) return item;
          return worst;
        }, null)
      : translation;
    return {
      id: segment.id,
      time: timeFormatter.format(segment.startedAt),
      speaker: segment.speakerId ?? commonDict.speaker,
      primaryText,
      primaryLang,
      primaryIsFallback: !isSourceLanguage && !translation,
      secondaryText: !isSourceLanguage ? segment.originalText : undefined,
      secondaryLang: !isSourceLanguage ? segment.language : undefined,
      confidenceBadge:
        scoredTranslation?.confidence != null && scoredTranslation.confidenceLevel ? (
          <ConfidenceBadge
            score={scoredTranslation.confidence}
            level={scoredTranslation.confidenceLevel as "high" | "medium" | "low"}
            rootCause={scoredTranslation.rootCause as RootCause | null}
            uiLang={lang}
          />
        ) : undefined,
    };
  });
  const statusLabel = {
    [SessionStatus.DRAFT]: dict.statusDraft,
    [SessionStatus.LIVE]: dict.statusLive,
    [SessionStatus.ENDED]: dict.statusEnded,
  }[session.status];

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const learnerToken = cookieStore.get(learnerInviteCookieName(sessionId))?.value;
  const learnerLink = learnerToken ? `${appUrl}/join/${learnerToken}` : null;
  let learnerLinkQrCode: string | null = null;
  if (learnerLink) {
    const headerList = await headers();
    const origin = `${headerList.get("x-forwarded-proto") ?? "http"}://${headerList.get("host") ?? "localhost:3000"}`;
    learnerLinkQrCode = await QRCode.toDataURL(`${origin}${learnerLink}`, { margin: 1, width: 176 });
  }
  const startAction = startSession.bind(null, sessionId);
  const endAction = endSession.bind(null, sessionId);
  const revokeInviteAction = revokeLearnerInvite.bind(null, sessionId);
  const changeLanguageAction = updateFacilitatorLanguage.bind(null, sessionId);
  const sendChatAction = sendChatMessage.bind(null, sessionId, "facilitator");
  const chatMessages = [...session.messages].reverse();
  const learnerInviteRevoked = session.joinLinks.some((link) => link.revokedAt !== null);
  const recentlyEnded =
    session.status === SessionStatus.ENDED &&
    session.endedAt !== null &&
    new Date().getTime() - session.endedAt.getTime() < POST_SESSION_INSIGHT_GRACE_MS;
  // Deterministic participation stats, computed from data already fetched/queried above —
  // shown immediately in the ended-session summary card, unlike `session.summary` (the
  // async Claude narrative below it), which only exists once
  // generateAndPersistSessionSummary finishes and a poll picks it up.
  const sessionSummary = {
    durationMinutes:
      session.startedAt && session.endedAt
        ? Math.round((session.endedAt.getTime() - session.startedAt.getTime()) / 60_000)
        : null,
    messageCount,
    questionCount,
    misunderstoodTopics: session.insights
      .filter((item) => item.type === "CONFUSION")
      .slice(0, 5)
      .map((item) => item.summary),
  };

  return (
    <div className="flex flex-col gap-6">
      <SyncUiLanguage lang={lang} />
      {/*
        Poll during DRAFT too, not just LIVE: while waiting to start, the
        facilitator needs the "learners joined" count (Card below) to update
        as people use the QR/link, without a manual reload.
      */}
      {(session.status === SessionStatus.DRAFT || session.status === SessionStatus.LIVE) && <SessionAutoRefresh />}
      {recentlyEnded && <SessionAutoRefresh durationMs={POST_SESSION_INSIGHT_GRACE_MS} />}
      <LanguageMenu
        current={lang}
        onSelect={changeLanguageAction}
        // updateFacilitatorLanguage only updates the session's language label/translation
        // target — it doesn't (and safely can't, without risking dropped audio mid-utterance)
        // reopen the underlying Deepgram/local-inference recognition stream, which stays
        // configured for whatever language it was opened with for the rest of its life. See
        // updateFacilitatorLanguage's own doc comment. This used to render as a permanent
        // banner above the page title for the entire LIVE duration regardless of whether
        // it was ever relevant — now it only shows inside the menu itself, at the moment
        // someone is actually about to change the language.
        liveWarning={session.status === SessionStatus.LIVE ? dict.languageChangeLiveWarning : undefined}
      />
      <div>
        <div className="flex flex-wrap items-center gap-3" aria-live="polite">
          <h1 className="font-heading text-2xl font-semibold">{session.title}</h1>
          {session.status !== SessionStatus.DRAFT && (
            <span
              className="font-data rounded-full border border-border-strong px-2.5 py-1 text-xs font-medium uppercase tracking-wider"
              style={{ color: session.status === SessionStatus.LIVE ? "var(--tick-high)" : "var(--muted-foreground)" }}
            >
              {statusLabel}
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{session.goal}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3" aria-live="polite">
        {session.status === SessionStatus.DRAFT && (
          <form action={startAction}>
            <button className="font-data rounded-md bg-accent-fill px-5 py-2 text-xs font-medium uppercase tracking-wider text-accent-foreground">
              {dict.startSession}
            </button>
          </form>
        )}
        {session.status === SessionStatus.LIVE && (
          <form action={endAction}>
            <ConfirmSubmitButton
              label={dict.endSession}
              pendingLabel={dict.endSession}
              title={dict.confirmEndSessionTitle}
              body={dict.confirmEndSessionBody}
              confirmLabel={getDictionary(lang).common.confirm}
              cancelLabel={getDictionary(lang).common.cancel}
              variant="danger"
            />
          </form>
        )}
        <span className="font-data text-xs text-muted-foreground" title={dict.learnersJoinedHint}>
          {dict.learnersJoinedLabel(session.participants.length)}
        </span>
        <Link
          href={`/sessions/${sessionId}/facilitator/glossary`}
          className="font-data ml-auto rounded-md border border-border-strong px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-foreground hover:border-accent hover:text-accent"
        >
          {dict.glossaryNavLabel}
        </Link>
      </div>
      {session.status === SessionStatus.LIVE && (
        <section className="flex flex-col gap-3">
          <Card eyebrow={dict.workshopRoom} title={dict.liveAudioVideo} accent="var(--tick-high)">
            <p className="text-muted-foreground">{dict.micCameraHint}</p>
            <Link
              href={`/sessions/${sessionId}/facilitator/room`}
              className="font-data mt-3 inline-block w-fit rounded-md bg-accent px-5 py-2 text-xs font-medium uppercase tracking-wider text-accent-foreground"
            >
              {getDictionary(lang).common.joinLiveSession}
            </Link>
          </Card>
          <AnalyticsDrawer
            analytics={analytics}
            isFrozen={false}
            labels={analyticsLabels}
            participationRows={analyticsParticipationRows}
            blockersSummary={analyticsBlockersSummary}
            languageRows={analyticsLanguageRows}
            confidenceSummary={analyticsConfidenceSummary}
          />
        </section>
      )}
      {/* Once a session ends, the "join live session" card above stops rendering
          entirely (there's no live room left to join) — without a replacement here, the
          transcript/chat this section's own data was already fetched for (session.transcript,
          session.messages, both queried unconditionally above) had no UI left anywhere on
          this page, making the whole session's record unretrievable the moment it ended. */}
      {session.status === SessionStatus.ENDED && (
        <section className="flex flex-col gap-3">
          <h2 className="font-data text-xs font-medium uppercase tracking-wider text-muted-foreground">{dict.sessionEndedHeading}</h2>
          <p className="text-sm text-muted-foreground">{dict.sessionEndedSummary}</p>
          <Card eyebrow={dict.sessionSummaryHeading}>
            {/* Deterministic — renders immediately from data already fetched above, unlike
                the async narrative below it (session.summary), which only exists once
                generateAndPersistSessionSummary finishes and a poll picks it up. */}
            <p className="font-data text-xs text-muted-foreground">
              {sessionSummary.durationMinutes !== null && `${dict.sessionSummaryDuration(sessionSummary.durationMinutes)} · `}
              {sessionSummary.messageCount} {dict.sessionSummaryMessages.toLowerCase()} · {sessionSummary.questionCount}{" "}
              {dict.sessionSummaryQuestions.toLowerCase()}
            </p>
            {sessionSummary.misunderstoodTopics.length > 0 && (
              <div className="mt-2">
                <p className="font-data text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {dict.sessionSummaryMisunderstoodTopics}
                </p>
                <ul className="mt-1 list-inside list-disc text-sm">
                  {sessionSummary.misunderstoodTopics.map((topic) => (
                    <li key={topic}>{topic}</li>
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
          {pendingGlossarySuggestions.length > 0 && (
            <Card eyebrow={dict.glossarySuggestionsHeading}>
              <p className="text-sm text-muted-foreground">{dict.glossarySuggestionsHint}</p>
              <ul className="mt-3 flex flex-col gap-2">
                {pendingGlossarySuggestions.map((suggestion) => (
                  <li
                    key={suggestion.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-subtle p-2"
                  >
                    <div>
                      <span className="font-medium">{suggestion.sourceTerm}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {dict.glossarySuggestionOccurrences(suggestion.occurrenceCount)}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <form action={approveGlossarySuggestion.bind(null, sessionId, suggestion.id)}>
                        <button className="font-data rounded-md bg-accent-fill px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-accent-foreground">
                          {dict.glossarySuggestionApprove}
                        </button>
                      </form>
                      <form action={ignoreGlossarySuggestion.bind(null, sessionId, suggestion.id)}>
                        <button className="font-data rounded-md border border-border-strong px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-foreground hover:bg-background">
                          {dict.glossarySuggestionIgnore}
                        </button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <AnalyticsDrawer
            analytics={analytics}
            isFrozen={true}
            labels={analyticsLabels}
            participationRows={analyticsParticipationRows}
            blockersSummary={analyticsBlockersSummary}
            languageRows={analyticsLanguageRows}
            confidenceSummary={analyticsConfidenceSummary}
          />
          <SessionSidePanel
            chat={{
              messages: chatMessages,
              targetLanguage: session.sourceLanguage,
              sendAction: sendChatAction,
              viewerIsFacilitator: true,
              readOnly: true,
            }}
            captions={{
              entries: transcriptEntries,
              emptyLabel: dict.transcriptEmpty,
              jumpToLatestLabel: commonDict.jumpToLatest,
            }}
            captionsHeader={
              textToSpeechProvider.isConfigured && (
                <TranslatedAudioPlayer
                  segments={session.transcript.map((segment) => ({
                    id: segment.id,
                    hasTranslation:
                      segment.language === session.sourceLanguage ||
                      segment.translations.some((item) => item.targetLanguage === session.sourceLanguage),
                    isTyped: segment.isTyped,
                  }))}
                  preferredLanguage={session.sourceLanguage}
                />
              )
            }
            chatTabLabel={commonDict.chatTab}
            captionsTabLabel={commonDict.captionsTab}
          />
        </section>
      )}
      <section className="flex flex-col gap-3" aria-live="polite">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="font-data text-xs font-medium uppercase tracking-wider text-muted-foreground">{dict.actNow}</h2>
            {confusionLevel.level !== "CALM" && (
              <span
                className="font-data rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider"
                style={{
                  color: confusionLevel.level === "HIGH" ? "var(--tick-low)" : "var(--tick-medium)",
                  borderColor: "currentColor",
                }}
                title={dict.confusionBadgeTooltip(confusionWindowMinutes)}
              >
                {confusionLevel.level === "HIGH"
                  ? dict.confusionLevelHigh(confusionLevel.count)
                  : dict.confusionLevelSome(confusionLevel.count)}
              </span>
            )}
          </div>
        </div>
        {learnerConfusionLevels.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {learnerConfusionLevels.map((entry) => {
              const name = learnerDisplayNames.get(entry.userId) ?? commonDict.speaker;
              return (
                <span
                  key={entry.userId}
                  className="font-data rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider"
                  style={{
                    color: entry.level === "HIGH" ? "var(--tick-low)" : "var(--tick-medium)",
                    borderColor: "currentColor",
                  }}
                  title={dict.learnerQuestionsBadgeTooltip(confusionWindowMinutes)}
                >
                  {name} ·{" "}
                  {entry.level === "HIGH" ? dict.learnerQuestionsHigh(entry.count) : dict.learnerQuestionsSome(entry.count)}
                </span>
              );
            })}
          </div>
        )}
        {activeActionItems.length > 0 ? (
          <div className="flex flex-col gap-3">
            {activeActionItems.map((item) => {
              const evidence = item.evidence[0]?.transcriptSegment;
              const evidenceIsSourceLanguage = evidence?.language === session.sourceLanguage;
              const translation = evidence?.translations.find((t) => t.targetLanguage === session.sourceLanguage);
              const evidenceText = evidenceIsSourceLanguage
                ? evidence?.originalText
                : (translation?.text ?? getDictionary(lang).common.translationUnavailable);
              // The fallback text (getDictionary(lang).common.translationUnavailable above)
              // is itself localized to `lang`, not fixed English copy — tag it `lang`,
              // not "en".
              const evidenceLang = evidenceIsSourceLanguage ? evidence?.language : translation ? session.sourceLanguage : lang;
              const resolveAction = resolveInsight.bind(null, sessionId, item.id);
              // CONFUSION reads as a signal to check comprehension, not a hard blocker to
              // fix — same card shape and resolve action (a facilitator "handling" either
              // means the same thing here: they noticed and responded), different label/
              // accent so the two aren't visually indistinguishable in the same queue.
              const isConfusion = item.type === "CONFUSION";
              return (
                <Card
                  key={item.id}
                  eyebrow={isConfusion ? dict.confusion : dict.blocker}
                  accent={isConfusion ? "var(--tick-medium)" : "var(--tick-low)"}
                >
                  <p>{item.summary}</p>
                  {evidence && (
                    <p
                      className="mt-2 whitespace-pre-wrap rounded-md border border-border-subtle bg-background p-2 text-xs italic text-muted-foreground"
                      lang={evidenceLang}
                    >
                      “{evidenceText}”
                    </p>
                  )}
                  <form action={resolveAction} className="mt-2">
                    <button className="font-data rounded-md border border-border-strong px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-foreground hover:border-[var(--tick-high)] hover:text-[var(--tick-high)]">
                      {dict.resolveBlocker}
                    </button>
                  </form>
                </Card>
              );
            })}
          </div>
        ) : transcriptEntries.length === 0 ? (
          <Card eyebrow={dict.waitingToStart}>
            <p className="text-muted-foreground">{dict.noInterventionHintWaiting}</p>
          </Card>
        ) : !insightProvider.isConfigured ? (
          // Distinct from "looks on track" below — that phrasing asserts insight
          // detection actually ran and found nothing, which would be actively
          // misleading when it never ran at all (no INSIGHT_MODEL_API_KEY set).
          <Card eyebrow={dict.noInterventionYet}>
            <p className="text-muted-foreground">{dict.insightsNotConfigured}</p>
          </Card>
        ) : confusionLevel.level !== "CALM" ? (
          // The group confusion badge above counts RESOLVED insights too, by design
          // (confusion-level.ts: "resolution means the facilitator responded, not that
          // the confusion didn't happen") — so once every action item is resolved, the
          // unconditional "no blockers or confusion detected yet" copy below would
          // directly contradict a still-visible Some/High confusion badge in the same
          // glance. This branch only fires when that's actually the case.
          <Card eyebrow={dict.noInterventionYet}>
            <p className="text-muted-foreground">{dict.noInterventionHintRecentConfusion}</p>
          </Card>
        ) : (
          <Card eyebrow={dict.noInterventionYet}>
            <p className="text-muted-foreground">{dict.noInterventionHintOnTrack}</p>
          </Card>
        )}
      </section>
      <section className="flex flex-col gap-3" aria-live="polite">
        <h2 className="font-data text-xs font-medium uppercase tracking-wider text-muted-foreground">{dict.currentLesson}</h2>
        {(() => {
          // Pulled from the already-fetched `session.insights` (ordered newest-first,
          // capped at INSIGHT_HISTORY_LIMIT) rather than a separate query — ACTIVITY/
          // DECISION are a running informational log for context, not action items
          // needing their own unbounded "never miss an old unresolved one" query the
          // way "Act now" above needs (there's nothing to resolve here). Capped further
          // to the 5 most recent so this section stays a glance-able summary, not a
          // second full transcript.
          const recentContext = session.insights.filter((item) => item.type === "ACTIVITY" || item.type === "DECISION").slice(0, 5);
          if (recentContext.length === 0) {
            return (
              <Card>
                <p className="text-muted-foreground">{dict.noRecentActivity}</p>
              </Card>
            );
          }
          return (
            <div className="flex flex-col gap-3">
              {recentContext.map((item) => (
                <Card key={item.id} eyebrow={item.type === "DECISION" ? dict.decision : dict.activity}>
                  <p>{item.summary}</p>
                </Card>
              ))}
            </div>
          );
        })()}
      </section>
      {/* The old standalone "Live transcript" section (a flat stacked-card list) was
          removed here — superseded by the tabbed SessionSidePanel above, whose
          "captions" tab (LiveTranscriptFeed) renders the exact same transcript data
          as a YouTube-live-chat-style auto-scrolling feed instead, so keeping both
          would just show the transcript twice. */}
      {/* No session list exists anywhere in the app, and facilitator auth is a per-session
          cookie, not an account — this dashboard URL, once lost, is the only way back
          into a still-LIVE session. Same copy-link affordance as the learner invite card
          below, so a facilitator can actually save it. */}
      <Card eyebrow={dict.dashboardLinkCard} title={dict.dashboardLinkHeading}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            aria-label={dict.dashboardLinkAriaLabel}
            className="w-full flex-1 rounded-md border border-border-strong bg-background px-3 py-2 font-data text-xs text-foreground"
            readOnly
            value={`${appUrl}/sessions/${sessionId}/facilitator`}
          />
          <CopyLinkButton
            value={`${appUrl}/sessions/${sessionId}/facilitator`}
            label={dict.copyLink}
            copiedLabel={dict.linkCopied}
            failedLabel={dict.copyFailed}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{dict.dashboardLinkHint}</p>
      </Card>
      <Card eyebrow={dict.learnerInvitation} title={dict.shareLink}>
        {learnerInviteRevoked ? (
          <p className="text-muted-foreground">{dict.linkRevokedMsg}</p>
        ) : learnerLink ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              {learnerLinkQrCode && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt={dict.qrAlt}
                  className="h-24 w-24 rounded-md border border-border-strong bg-white p-1"
                  height={96}
                  src={learnerLinkQrCode}
                  width={96}
                />
              )}
              <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  aria-label={dict.learnerLinkAriaLabel}
                  className="w-full flex-1 rounded-md border border-border-strong bg-background px-3 py-2 font-data text-xs text-foreground"
                  readOnly
                  value={learnerLink}
                />
                <CopyLinkButton
                  value={learnerLink}
                  label={dict.copyLink}
                  copiedLabel={dict.linkCopied}
                  failedLabel={dict.copyFailed}
                />
              </div>
            </div>
            <form action={revokeInviteAction}>
              <ConfirmSubmitButton
                label={dict.revokeInvite}
                pendingLabel={dict.revokeInvite}
                title={dict.confirmRevokeInviteTitle}
                body={dict.confirmRevokeInviteBody}
                confirmLabel={getDictionary(lang).common.confirm}
                cancelLabel={getDictionary(lang).common.cancel}
                variant="danger"
              />
            </form>
          </div>
        ) : (
          <p className="text-muted-foreground">{dict.linkMissingMsg}</p>
        )}
      </Card>
    </div>
  );
}
