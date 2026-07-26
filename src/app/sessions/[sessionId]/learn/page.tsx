import type { Metadata } from "next";
import { Card } from "@/components/ui/Card";
import { WorkshopRoomLayout } from "@/components/WorkshopRoomLayout";
import type { TranscriptFeedEntry } from "@/components/LiveTranscriptFeed";
import { SessionAutoRefresh } from "@/components/SessionAutoRefresh";
import { SessionSidePanel } from "@/components/SessionSidePanel";
import { TranslatedAudioPlayer } from "@/components/TranslatedAudioPlayer";
import { ChatSendButton } from "@/components/ChatSendButton";
import { CaptionComprehensionActions } from "@/components/CaptionComprehensionActions";
import { SyncUiLanguage } from "@/components/SyncUiLanguage";
import { LanguageMenu } from "@/components/LanguageMenu";
import { notFound, redirect } from "next/navigation";
import { ParticipantRole, SessionStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { learnerParticipantId } from "@/lib/session-access";
import { textToSpeechProvider } from "@/lib/providers/text-to-speech";
import { MESSAGE_HISTORY_LIMIT, SUPPORTED_LANGUAGES, TRANSCRIPT_HISTORY_LIMIT } from "@/lib/session-contracts";
import { getDictionary, resolveLanguage } from "@/lib/i18n";
import { isSessionRetentionExpired } from "@/lib/session-retention";
import { sendChatMessage } from "@/app/sessions/actions";
import { publishLearnerCaption, updateLearnerLanguage } from "@/app/sessions/[sessionId]/learn/actions";

export const metadata: Metadata = { title: "Learner session" };

export default async function LearnerSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const participantId = await learnerParticipantId(sessionId);
  if (!participantId) redirect("/setup");

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
  const sendChatAction = sendChatMessage.bind(null, sessionId, "learner");
  const lang = resolveLanguage(participant.preferredLanguage);
  const dict = getDictionary(lang);
  const learnerDict = dict.learner;
  const learnerLanguageOptions = SUPPORTED_LANGUAGES.filter((language) =>
    participant.session.learnerLanguages.includes(language.value),
  );
  const changeLanguageAction = updateLearnerLanguage.bind(null, sessionId);
  const publishCaptionAction = publishLearnerCaption.bind(null, sessionId);
  const timeFormatter = new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" });
  const transcriptEntries: TranscriptFeedEntry[] = participant.session.transcript.map((segment) => {
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
    return {
      id: segment.id,
      time: timeFormatter.format(segment.startedAt),
      speaker: segment.speakerId ?? dict.common.speaker,
      primaryText,
      primaryLang,
      primaryIsFallback: !isOwnLanguage && !translation,
      secondaryText: !isOwnLanguage ? segment.originalText : undefined,
      secondaryLang: !isOwnLanguage ? segment.language : undefined,
      // A pre-built element, not a callback prop — see TranscriptFeedEntry.actions'
      // doc comment for why (this page is a Server Component; the feed isn't).
      actions: (
        <CaptionComprehensionActions
          sendAction={sendChatAction}
          explainSimplyLabel={learnerDict.explainSimply}
          giveExampleLabel={learnerDict.giveExample}
          sendingLabel={dict.chat.sending}
          explainSimplyMessage={learnerDict.explainSimplyQuestion(originalText)}
          giveExampleMessage={learnerDict.giveExampleQuestion(originalText)}
        />
      ),
    };
  });
  const latestCaptionText = transcriptEntries.at(-1)?.primaryText;

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
          <p className="text-sm text-muted-foreground">{learnerDict.subtitle}</p>
        </div>
        <Card eyebrow={learnerDict.preferencesCard}>
          <p>
            {learnerDict.preferredLanguageLabel} <strong>{dict.languageNames[lang]}</strong>
          </p>
        </Card>
      </div>
      {participant.session.status === SessionStatus.LIVE && (
        <section className="flex flex-col gap-3">
          <h2 className="font-data text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {dict.facilitator.workshopRoom}
          </h2>
          <WorkshopRoomLayout
            sessionId={participant.session.id}
            role="learner"
            lang={lang}
            captionText={latestCaptionText}
            sidebar={
              <SessionSidePanel
                chat={{
                  messages: [...participant.session.messages].reverse(),
                  targetLanguage: participant.preferredLanguage,
                  sendAction: sendChatAction,
                  allowQuestions: true,
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
                captionComposer={
                  <form action={publishCaptionAction} className="flex flex-col gap-2 border-t border-border-subtle p-4">
                    <label className="sr-only" htmlFor="learner-caption">{learnerDict.captionComposerLabel}</label>
                    <textarea
                      id="learner-caption"
                      className="resize-none rounded-md border border-border-strong bg-background p-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
                      name="captionText"
                      rows={2}
                      required
                      maxLength={3000}
                      placeholder={learnerDict.captionComposerPlaceholder}
                    />
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs text-muted-foreground">{learnerDict.captionAudioHint}</p>
                      <ChatSendButton label={learnerDict.publish} sendingLabel={learnerDict.publishing} />
                    </div>
                  </form>
                }
                chatTabLabel={dict.common.chatTab}
                captionsTabLabel={dict.common.captionsTab}
              />
            }
          />
        </section>
      )}
    </div>
  );
}
