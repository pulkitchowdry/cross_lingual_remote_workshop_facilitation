import type { Metadata } from "next";
import { Card } from "@/components/ui/Card";
import { WorkshopRoomLayout } from "@/components/WorkshopRoomLayout";
import { SessionAutoRefresh } from "@/components/SessionAutoRefresh";
import { SessionChatPanel } from "@/components/SessionChatPanel";
import { TranslatedAudioPlayer } from "@/components/TranslatedAudioPlayer";
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
import { updateLearnerLanguage } from "@/app/sessions/[sessionId]/learn/actions";

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
  const transcript = [...participant.session.transcript].reverse();

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
      {participant.session.status === SessionStatus.LIVE && (
        <section className="flex flex-col gap-3">
          <div>
            <p className="font-data text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {dict.facilitator.workshopRoom}
            </p>
            <h2 className="font-heading text-lg font-semibold">{dict.facilitator.liveAudioVideo}</h2>
            <p className="text-sm text-muted-foreground">{dict.facilitator.micCameraHint}</p>
          </div>
          <WorkshopRoomLayout
            sessionId={participant.session.id}
            role="learner"
            lang={lang}
            sidebar={
              <SessionChatPanel
                messages={[...participant.session.messages].reverse()}
                targetLanguage={participant.preferredLanguage}
                sendAction={sendChatAction}
                allowQuestions
              />
            }
          />
        </section>
      )}
      <section className="flex flex-col gap-3" aria-live="polite">
        <div>
          <p className="font-data text-xs font-medium uppercase tracking-wider text-muted-foreground">{learnerDict.liveCaptions}</p>
          <h2 className="font-heading text-lg font-semibold">
            {participant.session.status === SessionStatus.LIVE
              ? learnerDict.followExplanation
              : participant.session.status === SessionStatus.ENDED
                ? learnerDict.sessionEnded
                : learnerDict.waitingForFacilitator}
          </h2>
        </div>
        {textToSpeechProvider.isConfigured && (
          <TranslatedAudioPlayer
            segments={transcript.map((segment) => ({
              id: segment.id,
              hasTranslation:
                segment.language === participant.preferredLanguage ||
                segment.translations.some((item) => item.targetLanguage === participant.preferredLanguage),
            }))}
            preferredLanguage={participant.preferredLanguage}
          />
        )}
        {transcript.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {transcript.map((segment) => {
              const isOwnLanguage = segment.language === participant.preferredLanguage;
              const translation = segment.translations.find(
                (item) => item.targetLanguage === participant.preferredLanguage,
              );
              const primaryText = isOwnLanguage
                ? segment.originalText
                : (translation?.text ?? dict.common.translationUnavailable);
              // Both non-own-language branches resolve to the learner's preferred
              // language: `translation.text` is translated *into* it, and the
              // dict.common.translationUnavailable fallback is itself localized to it
              // (see i18n.ts's `common` dictionary) — neither is fixed English copy.
              const primaryLang = isOwnLanguage ? segment.language : participant.preferredLanguage;
              return (
                <Card key={segment.id} title={segment.speakerId ?? dict.common.speaker} meta={segment.language.toUpperCase()}>
                  <p
                    className="text-base leading-relaxed"
                    lang={primaryLang}
                    style={!isOwnLanguage && !translation ? { color: "var(--tick-low)" } : undefined}
                  >
                    {primaryText}
                  </p>
                  {!isOwnLanguage && (
                    <p className="mt-2 text-xs italic text-muted-foreground" lang={segment.language}>
                      {segment.originalText}
                    </p>
                  )}
                </Card>
              );
            })}
          </div>
        ) : (
          <Card eyebrow={learnerDict.captionStream}>
            <p className="text-muted-foreground">{learnerDict.captionsWillAppear}</p>
          </Card>
        )}
      </section>
    </div>
  );
}
