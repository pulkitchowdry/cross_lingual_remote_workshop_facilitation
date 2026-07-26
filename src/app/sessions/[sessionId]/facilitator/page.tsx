import type { Metadata } from "next";
import QRCode from "qrcode";
import { Card } from "@/components/ui/Card";
import { WorkshopRoomLayout } from "@/components/WorkshopRoomLayout";
import type { TranscriptFeedEntry } from "@/components/LiveTranscriptFeed";
import { SessionAutoRefresh } from "@/components/SessionAutoRefresh";
import { SessionSidePanel } from "@/components/SessionSidePanel";
import { LiveCaptionStream } from "@/components/LiveCaptionStream";
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
import { speechToTextProvider } from "@/lib/providers/speech-to-text";
import { insightProvider } from "@/lib/providers/insight";
import { textToSpeechProvider } from "@/lib/providers/text-to-speech";
import { getDictionary, resolveLanguage } from "@/lib/i18n";
import { INSIGHT_HISTORY_LIMIT, MESSAGE_HISTORY_LIMIT, TRANSCRIPT_HISTORY_LIMIT } from "@/lib/session-contracts";
import { computeConfusionLevel } from "@/lib/confusion-level";
import { computeLearnerConfusionLevels } from "@/lib/learner-confusion";
import { isSessionRetentionExpired } from "@/lib/session-retention";
import { CaptionPublishForm } from "@/components/CaptionPublishForm";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import {
  endSession,
  publishCaption,
  resolveInsight,
  revokeLearnerInvite,
  startSession,
  updateFacilitatorLanguage,
} from "@/app/sessions/[sessionId]/facilitator/actions";
import { sendChatMessage } from "@/app/sessions/actions";

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

  const [session, activeActionItems] = await Promise.all([
    prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        participants: { where: { role: ParticipantRole.LEARNER }, include: { user: true } },
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
  ]);
  if (!session) notFound();
  // The hourly cleanup cron (retention/cleanup/route.ts) physically deletes an
  // expired session's data, but nothing stops it being served here in the
  // meantime — up to an hour after its own retention deadline, or indefinitely
  // if the cron never runs (e.g. CRON_SECRET was never set). Treat it as gone
  // as soon as it's due, not just once the delete has actually happened.
  if (isSessionRetentionExpired(session)) notFound();

  // session.insights is capped at INSIGHT_HISTORY_LIMIT (see the query above); that cap
  // can only truncate the CONFUSION count when insight volume is already high enough to be
  // well past the HIGH threshold regardless, so the computed level stays correct.
  const confusionTimestamps = session.insights
    .filter((item) => item.type === "CONFUSION")
    .map((item) => item.createdAt);
  const confusionLevel = computeConfusionLevel(confusionTimestamps, new Date());

  // session.messages is capped at MESSAGE_HISTORY_LIMIT (see the query above); same
  // truncation tradeoff as confusionTimestamps above — only under-counts once message
  // volume is already high enough to be well past HIGH regardless.
  const learnerUserIds = new Set(session.participants.map((participant) => participant.userId));
  const questionMessages = session.messages
    .filter((message) => message.kind === "QUESTION")
    .map((message) => ({ senderId: message.senderId, sentAt: message.sentAt }));
  const learnerConfusionLevels = computeLearnerConfusionLevels(questionMessages, learnerUserIds, new Date());
  const learnerDisplayNames = new Map(
    session.participants.map((participant) => [participant.userId, participant.user.displayName]),
  );

  const lang = resolveLanguage(session.sourceLanguage);
  const dict = getDictionary(lang).facilitator;
  const commonDict = getDictionary(lang).common;
  const timeFormatter = new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" });
  const transcriptEntries: TranscriptFeedEntry[] = session.transcript.map((segment) => {
    // Segments used to always be facilitator-authored (always in sourceLanguage), but
    // learners can now type captions too, in their own preferredLanguage — so this can no
    // longer just show originalText and assume it's already the facilitator's language.
    const isSourceLanguage = segment.language === session.sourceLanguage;
    const translation = segment.translations.find((item) => item.targetLanguage === session.sourceLanguage);
    const primaryText = isSourceLanguage ? segment.originalText : (translation?.text ?? commonDict.translationUnavailable);
    const primaryLang = isSourceLanguage ? segment.language : translation ? session.sourceLanguage : "en";
    return {
      id: segment.id,
      time: timeFormatter.format(segment.startedAt),
      speaker: segment.speakerId ?? commonDict.speaker,
      primaryText,
      primaryLang,
      primaryIsFallback: !isSourceLanguage && !translation,
      secondaryText: !isSourceLanguage ? segment.originalText : undefined,
      secondaryLang: !isSourceLanguage ? segment.language : undefined,
    };
  });
  const latestCaptionText = transcriptEntries.at(-1)?.primaryText;
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
  const publishCaptionAction = publishCaption.bind(null, sessionId);
  const revokeInviteAction = revokeLearnerInvite.bind(null, sessionId);
  const sendChatAction = sendChatMessage.bind(null, sessionId, "facilitator");
  const changeLanguageAction = updateFacilitatorLanguage.bind(null, sessionId);
  const chatMessages = [...session.messages].reverse();
  const transcript = [...session.transcript].reverse();
  const learnerInviteRevoked = session.joinLinks.some((link) => link.revokedAt !== null);
  const recentlyEnded =
    session.status === SessionStatus.ENDED &&
    session.endedAt !== null &&
    new Date().getTime() - session.endedAt.getTime() < POST_SESSION_INSIGHT_GRACE_MS;

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
      <LanguageMenu current={lang} onSelect={changeLanguageAction} />
      {session.status === SessionStatus.LIVE && (
        // updateFacilitatorLanguage only updates the session's language label/translation
        // target — it doesn't (and safely can't, without risking dropped audio mid-utterance)
        // reopen the underlying Deepgram/local-inference recognition stream, which stays
        // configured for whatever language it was opened with for the rest of its life. See
        // updateFacilitatorLanguage's own doc comment.
        <p className="text-xs text-muted-foreground">{dict.languageChangeLiveWarning}</p>
      )}
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
          {session.participants.length} {dict.learnersJoinedCard.toLowerCase()}
        </span>
      </div>
      {session.status === SessionStatus.LIVE && (
        <section className="flex flex-col gap-3">
          <h2 className="font-data text-xs font-medium uppercase tracking-wider text-muted-foreground">{dict.workshopRoom}</h2>
          <WorkshopRoomLayout
            sessionId={session.id}
            role="facilitator"
            lang={lang}
            captionText={latestCaptionText}
            belowVideo={
              speechToTextProvider.isConfigured && (
                <LiveCaptionStream
                  sessionId={session.id}
                  lang={lang}
                  agentCapturing={session.captionAgentActive}
                />
              )
            }
            sidebar={
              <SessionSidePanel
                chat={{
                  messages: chatMessages,
                  targetLanguage: session.sourceLanguage,
                  sendAction: sendChatAction,
                  viewerIsFacilitator: true,
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
                captionComposer={
                  <CaptionPublishForm
                    action={publishCaptionAction}
                    dict={{
                      captionLabel: dict.captionLabel,
                      captionPlaceholder: dict.captionPlaceholder,
                      captionAudioHint: dict.captionAudioHint,
                      publish: dict.publish,
                      publishing: dict.publishing,
                    }}
                  />
                }
                chatTabLabel={commonDict.chatTab}
                captionsTabLabel={commonDict.captionsTab}
              />
            }
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
                >
                  {name} ·{" "}
                  {entry.level === "HIGH" ? dict.confusionLevelHigh(entry.count) : dict.confusionLevelSome(entry.count)}
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
        ) : transcript.length === 0 ? (
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
