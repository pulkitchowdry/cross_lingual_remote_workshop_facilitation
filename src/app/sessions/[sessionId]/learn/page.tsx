import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { SessionAutoRefresh } from "@/components/SessionAutoRefresh";
import { TranslatedAudioPlayer } from "@/components/TranslatedAudioPlayer";
import { SyncUiLanguage } from "@/components/SyncUiLanguage";
import { notFound, redirect } from "next/navigation";
import { ParticipantRole, SessionStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { learnerParticipantId } from "@/lib/session-access";
import { textToSpeechProvider } from "@/lib/providers/text-to-speech";
import { getDictionary, resolveLanguage } from "@/lib/i18n";

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
          transcript: { include: { translations: true }, orderBy: { startedAt: "asc" } },
        },
      },
      user: true,
    },
  });
  if (!participant) notFound();
  const lang = resolveLanguage(participant.preferredLanguage);
  const dict = getDictionary(lang);
  const learnerDict = dict.learner;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <SyncUiLanguage lang={lang} />
      {participant.session.status === SessionStatus.LIVE && <SessionAutoRefresh />}
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
            segments={participant.session.transcript.map((segment) => ({
              id: segment.id,
              hasTranslation:
                segment.language === participant.preferredLanguage ||
                segment.translations.some((item) => item.targetLanguage === participant.preferredLanguage),
            }))}
            preferredLanguage={participant.preferredLanguage}
          />
        )}
        {participant.session.transcript.length > 0 ? (
          <div className="flex flex-col gap-3">
            {participant.session.transcript.map((segment) => {
              const isOwnLanguage = segment.language === participant.preferredLanguage;
              const translation = segment.translations.find(
                (item) => item.targetLanguage === participant.preferredLanguage,
              );
              const primaryText = isOwnLanguage
                ? segment.originalText
                : (translation?.text ?? dict.common.translationUnavailable);
              // The fallback "Translation unavailable." string is fixed English UI copy, not a
              // translation — tag it "en" rather than the learner's preferred language.
              const primaryLang = isOwnLanguage ? segment.language : translation ? participant.preferredLanguage : "en";
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
