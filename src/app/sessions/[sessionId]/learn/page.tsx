import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import type { TranscriptFeedEntry } from "@/components/LiveTranscriptFeed";
import { SessionAutoRefresh } from "@/components/SessionAutoRefresh";
import { SessionSidePanel } from "@/components/SessionSidePanel";
import { TranslatedAudioPlayer } from "@/components/TranslatedAudioPlayer";
import { CaptionComprehensionActions } from "@/components/CaptionComprehensionActions";
import { ClarificationActions } from "@/components/ClarificationActions";
import { ConfidenceBadge } from "@/components/ui/ConfidenceBadge";
import type { RootCause } from "@/lib/confidence";
import { SyncUiLanguage } from "@/components/SyncUiLanguage";
import { LanguageMenu } from "@/components/LanguageMenu";
import { notFound, redirect } from "next/navigation";
import { ParticipantRole, SessionStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { learnerParticipantId } from "@/lib/session-access";
import { textToSpeechProvider } from "@/lib/providers/text-to-speech";
import { CHAT_MESSAGE_MAX_LENGTH, MESSAGE_HISTORY_LIMIT, SUPPORTED_LANGUAGES, TRANSCRIPT_HISTORY_LIMIT } from "@/lib/session-contracts";
import { getDictionary, resolveLanguage } from "@/lib/i18n";
import { isSessionRetentionExpired } from "@/lib/session-retention";
import { redactAnonymousSenders, visibleSessionMessageWhere } from "@/lib/message-visibility";
import { sendChatMessage } from "@/app/sessions/actions";
import { updateLearnerLanguage } from "@/app/sessions/[sessionId]/learn/actions";

export const metadata: Metadata = { title: "Learner session" };

/**
 * "Explain simply"/"Give an example" (CaptionComprehensionActions) wrap a caption
 * verbatim in a fixed phrase (see i18n.ts's explainSimplyQuestion/giveExampleQuestion)
 * and submit it through the same sendChatMessage that caps every message at
 * CHAT_MESSAGE_MAX_LENGTH — but captions themselves are allowed up to 3,000 characters
 * (facilitator/learn actions' own publish caps). Left untruncated, any caption long
 * enough makes the generated question exceed the chat cap, and sendChatMessage rejects
 * it every single time with no way for the learner to shorten a caption they didn't
 * write themselves — the button becomes permanently, silently broken for that caption.
 * The margin below is comfortably larger than the longest wrapper phrase + quote marks
 * across en/zh/es.
 */
const QUOTED_QUESTION_WRAPPER_MARGIN = 150;
function truncateForQuotedQuestion(text: string): string {
  const maxLength = CHAT_MESSAGE_MAX_LENGTH - QUOTED_QUESTION_WRAPPER_MARGIN;
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

export default async function LearnerSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const participantId = await learnerParticipantId(sessionId);
  if (!participantId) redirect("/setup");
  const accessParticipant = await prisma.sessionParticipant.findFirst({
    where: { id: participantId, sessionId, role: ParticipantRole.LEARNER },
    select: { userId: true },
  });
  if (!accessParticipant) notFound();

  const participant = await prisma.sessionParticipant.findFirst({
    where: { id: participantId, sessionId, role: ParticipantRole.LEARNER },
    include: {
      session: {
        include: {
          // A secondary `id` tiebreaker: see the matching comment in facilitator/page.tsx —
          // without one, two rows created within the same millisecond can silently swap
          // relative order between successive SessionAutoRefresh polls.
          transcript: {
            include: { translations: true },
            orderBy: [{ startedAt: "desc" }, { id: "desc" }],
            take: TRANSCRIPT_HISTORY_LIMIT,
          },
          messages: {
            where: visibleSessionMessageWhere(sessionId, accessParticipant.userId),
            include: { sender: true, translations: true },
            orderBy: [{ sentAt: "desc" }, { id: "desc" }],
            take: MESSAGE_HISTORY_LIMIT,
          },
        },
      },
      user: true,
    },
  });
  if (!participant) notFound();
  // See the matching check in facilitator/page.tsx: the hourly cleanup cron
  // physically deletes an expired session, but nothing else stops it being
  // served here in the meantime.
  if (isSessionRetentionExpired(participant.session)) notFound();
  const lang = resolveLanguage(participant.preferredLanguage);
  const dict = getDictionary(lang);
  const learnerDict = dict.learner;
  const learnerLanguageOptions = SUPPORTED_LANGUAGES.filter((language) =>
    participant.session.learnerLanguages.includes(language.value),
  );
  const changeLanguageAction = updateLearnerLanguage.bind(null, sessionId);
  const sendChatAction = sendChatMessage.bind(null, sessionId, "learner");
  const timeFormatter = new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" });
  // participant.session.transcript is fetched newest-first (`orderBy: startedAt desc`,
  // see the query above) so `take: TRANSCRIPT_HISTORY_LIMIT` keeps the N most recent
  // segments — reversed here to chronological order before mapping so LiveTranscriptFeed
  // (which renders top-to-bottom, newest at the bottom, per its own doc comment) reads
  // the array the right way round. See the matching fix/comment in facilitator/page.tsx.
  // Precomputed once, not per-line — see ClarificationActions' reasonLabels prop.
  const clarificationReasonLabels = {
    "could-not-hear": dict.common.clarificationReasonCouldNotHear,
    "translation-incorrect": dict.common.clarificationReasonTranslationIncorrect,
    "please-repeat": dict.common.clarificationReasonPleaseRepeat,
    "explain-differently": dict.common.clarificationReasonExplainDifferently,
  } as const;
  const transcriptEntries: TranscriptFeedEntry[] = [...participant.session.transcript].reverse().map((segment) => {
    const isOwnLanguage = segment.language === participant.preferredLanguage;
    const translation = segment.translations.find((item) => item.targetLanguage === participant.preferredLanguage);
    const primaryText = isOwnLanguage ? segment.originalText : (translation?.text ?? dict.common.translationUnavailable);
    // The fallback "Translation unavailable." string is fixed English UI copy, not a
    // translation — tag it "en" rather than the learner's preferred language.
    const primaryLang = isOwnLanguage ? segment.language : translation ? participant.preferredLanguage : "en";
    // segment.originalText, not primaryText — primaryText can hold the fixed
    // "Translation unavailable" placeholder, which should never end up quoted
    // in the comprehension question below.
    const originalText = segment.originalText;
    // Confidence Score (issue #130) only applies to translated lines — a learner's
    // own-language original wasn't translated at all, so there's nothing to score.
    const needsClarification =
      !isOwnLanguage && translation?.confidenceLevel && translation.confidenceLevel !== "high";
    return {
      id: segment.id,
      time: timeFormatter.format(segment.startedAt),
      speaker: segment.speakerId ?? dict.common.speaker,
      primaryText,
      primaryLang,
      primaryIsFallback: !isOwnLanguage && !translation,
      secondaryText: !isOwnLanguage ? segment.originalText : undefined,
      secondaryLang: !isOwnLanguage ? segment.language : undefined,
      confidenceBadge:
        !isOwnLanguage && translation?.confidence != null && translation.confidenceLevel ? (
          <ConfidenceBadge
            score={translation.confidence}
            level={translation.confidenceLevel as "high" | "medium" | "low"}
            rootCause={translation.rootCause as RootCause | null}
            uiLang={lang}
          />
        ) : undefined,
      // A pre-built element, not a callback prop — see TranscriptFeedEntry.actions'
      // doc comment for why (this page is a Server Component; the feed isn't).
      actions: (
        <div className="flex flex-col gap-2">
          <CaptionComprehensionActions
            sendAction={sendChatAction}
            explainSimplyLabel={learnerDict.explainSimply}
            giveExampleLabel={learnerDict.giveExample}
            sendingLabel={dict.chat.sending}
            explainSimplyMessage={learnerDict.explainSimplyQuestion(truncateForQuotedQuestion(originalText))}
            giveExampleMessage={learnerDict.giveExampleQuestion(truncateForQuotedQuestion(originalText))}
          />
          {needsClarification && (
            <ClarificationActions
              sendAction={sendChatAction}
              originalText={originalText}
              requestClarificationLabel={dict.common.requestClarification}
              reasonLabels={clarificationReasonLabels}
              sendingLabel={dict.chat.sending}
            />
          )}
        </div>
      ),
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <SyncUiLanguage lang={lang} />
      {/*
        Poll during DRAFT too, not just LIVE: while the learner is on
        "waiting for facilitator", nothing else on this page triggers a
        refetch — without polling here, the transition to LIVE (and the
        video room it unlocks below) is invisible until a manual reload.
      */}
      {(participant.session.status === SessionStatus.DRAFT || participant.session.status === SessionStatus.LIVE) && (
        <SessionAutoRefresh />
      )}
      <LanguageMenu current={lang} languages={learnerLanguageOptions} onSelect={changeLanguageAction} />
      {/* Narrower than the page's workshop-room-wide shell (see AppShell) — before the
          video room renders below, this is just two lines of text and a small card, which
          read as oddly sparse stretched across a wide monitor with nothing else to fill
          it. The video room and transcript grid further down keep the full page width. */}
      <div className="flex max-w-2xl flex-col gap-6">
        <div>
          <p className="font-data text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {learnerDict.welcome(participant.user.displayName)}
          </p>
          <h1 className="font-heading text-2xl font-semibold">{participant.session.title}</h1>
          {/* The facilitator's own dashboard shows this goal right under the title
              (facilitator/page.tsx) — this page fetches the exact same `session.goal`
              (a plain scalar field, already included with no extra query) but never
              rendered it anywhere, so a learner never learns what the workshop is
              actually trying to achieve, before, during, or after it, unlike the person
              running it. */}
          {participant.session.goal && <p className="text-sm text-muted-foreground">{participant.session.goal}</p>}
          <p className="text-sm text-muted-foreground">{learnerDict.subtitle}</p>
        </div>
        <Card eyebrow={learnerDict.preferencesCard}>
          <p>
            {learnerDict.preferredLanguageLabel} <strong>{dict.languageNames[lang]}</strong>
          </p>
        </Card>
      </div>
      {/* Shared aria-live region for the three status-dependent blocks below (DRAFT
          waiting card, LIVE workshop room, ENDED summary) — the DRAFT-to-LIVE swap is a
          SessionAutoRefresh-driven poll with no user action of its own, so without this a
          screen-reader user gets no announcement at all when the workshop actually
          starts; the page just silently replaces itself underneath them. */}
      <div aria-live="polite">
      {participant.session.status === SessionStatus.DRAFT && (
        <section className="max-w-2xl">
          <Card eyebrow={learnerDict.waitingHeading}>
            <p className="text-muted-foreground">{learnerDict.waitingHint}</p>
          </Card>
        </section>
      )}
      {participant.session.status === SessionStatus.LIVE && (
        <Card eyebrow={dict.common.liveNowTitle} title={dict.facilitator.liveAudioVideo} accent="var(--tick-high)">
          <p className="text-muted-foreground">{dict.common.liveNowHint}</p>
          <Link
            href={`/sessions/${sessionId}/learn/room`}
            className="font-data mt-3 inline-block w-fit rounded-md bg-accent px-5 py-2 text-xs font-medium uppercase tracking-wider text-accent-foreground"
          >
            {dict.common.joinLiveSession}
          </Link>
        </Card>
      )}
      {/* Before this, a learner had no on-page signal at all that the session had ended —
          the page just silently reverted to looking identical to the pre-start "waiting"
          view, and the transcript/chat data queried above (participant.session.transcript/
          messages, unconditionally) had no UI to render into once the "join live session"
          card above stopped rendering. Confirmed live: ending a session as the facilitator leaves the
          learner's tab with no indication anything changed and no way to retrieve what was
          said. */}
      {participant.session.status === SessionStatus.ENDED && (
        <section className="flex flex-col gap-3">
          <h2 className="font-data text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {learnerDict.sessionEndedHeading}
          </h2>
          <p className="text-sm text-muted-foreground">{learnerDict.sessionEndedSummary}</p>
          {/* Optional per FEATURE_LIST.md's "After Session" learner deliverables — reuses the
              facilitator dict's copy (dict.facilitator.sessionSummary*) rather than duplicating
              near-identical strings under `learner` too; the summary itself (Session.summary,
              generated once by generateAndPersistSessionSummary) isn't per-viewer translated,
              so it always renders in the session's source language regardless of who's reading
              it, same as the transcript's own secondary-language quotes elsewhere on this page. */}
          {participant.session.summary && (
            <Card eyebrow={dict.facilitator.sessionSummaryHeading}>
              <p className="whitespace-pre-wrap" lang={participant.session.sourceLanguage}>
                {participant.session.summary}
              </p>
            </Card>
          )}
          <SessionSidePanel
            chat={{
              messages: redactAnonymousSenders([...participant.session.messages].reverse()),
              targetLanguage: participant.preferredLanguage,
              sendAction: sendChatAction,
              readOnly: true,
            }}
            captions={{
              entries: transcriptEntries,
              emptyLabel: learnerDict.captionsWillAppear,
              jumpToLatestLabel: dict.common.jumpToLatest,
            }}
            captionsHeader={
              textToSpeechProvider.isConfigured && (
                <TranslatedAudioPlayer
                  segments={participant.session.transcript.map((segment) => ({
                    id: segment.id,
                    hasTranslation:
                      segment.language === participant.preferredLanguage ||
                      segment.translations.some((item) => item.targetLanguage === participant.preferredLanguage),
                    isTyped: segment.isTyped,
                  }))}
                  preferredLanguage={participant.preferredLanguage}
                />
              )
            }
            chatTabLabel={dict.common.chatTab}
            captionsTabLabel={dict.common.captionsTab}
          />
        </section>
      )}
      </div>
    </div>
  );
}
