import type { Metadata } from "next";
import { LiveSessionRoom } from "@/components/LiveSessionRoom";
import { CaptionPublishForm } from "@/components/CaptionPublishForm";
import { TranslatedAudioPlayer } from "@/components/TranslatedAudioPlayer";
import { SessionAutoRefresh } from "@/components/SessionAutoRefresh";
import { SyncUiLanguage } from "@/components/SyncUiLanguage";
import { notFound, redirect } from "next/navigation";
import { ParticipantRole, SessionStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { learnerParticipantId } from "@/lib/session-access";
import { getDictionary, resolveLanguage } from "@/lib/i18n";
import { textToSpeechProvider } from "@/lib/providers/text-to-speech";
import { sendChatMessage } from "@/app/sessions/actions";
import { publishLearnerCaption, updateLearnerLanguage } from "@/app/sessions/[sessionId]/learn/actions";
import { redactAnonymousSenders, visibleSessionMessageWhere } from "@/lib/message-visibility";
import { resolveTranslatedText } from "@/lib/translation-view";
import { SUPPORTED_LANGUAGES } from "@/lib/session-contracts";

export const metadata: Metadata = { title: "Live session" };

/**
 * Full-page takeover for the live meeting itself (see the dashboard page for
 * captions/preferences/history). Only reachable while the session is LIVE —
 * the learner dashboard's "Join live session" card is how they get here.
 */
export default async function LearnerRoomPage({
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
          transcript: { include: { translations: true }, orderBy: { startedAt: "asc" } },
          messages: {
            where: visibleSessionMessageWhere(sessionId, accessParticipant.userId),
            include: { sender: true, translations: true },
            orderBy: { sentAt: "desc" },
          },
          translations: true,
        },
      },
    },
  });
  if (!participant) notFound();
  if (participant.session.status !== SessionStatus.LIVE) redirect(`/sessions/${sessionId}/learn`);

  const lang = resolveLanguage(participant.preferredLanguage);
  const learnerDict = getDictionary(lang).learner;
  const sendChatAction = sendChatMessage.bind(null, sessionId, "learner");
  const changeLanguageAction = updateLearnerLanguage.bind(null, sessionId);
  const publishCaptionAction = publishLearnerCaption.bind(null, sessionId);
  const learnerLanguageOptions = SUPPORTED_LANGUAGES.filter((language) =>
    participant.session.learnerLanguages.includes(language.value),
  );
  // Same lookup as learn/page.tsx (the pre-live dashboard) — see its comment for why
  // this falls back to "Translation unavailable" rather than the untranslated original.
  const resolvedTitle = resolveTranslatedText(
    {
      language: participant.session.sourceLanguage,
      originalText: participant.session.title,
      translations: participant.session.translations
        .filter((translation) => translation.title != null)
        .map((translation) => ({ targetLanguage: translation.targetLanguage, text: translation.title! })),
    },
    lang,
  );
  const captionComposer = (
    <CaptionPublishForm
      action={publishCaptionAction}
      dict={{
        captionLabel: learnerDict.captionComposerLabel,
        captionPlaceholder: learnerDict.captionComposerPlaceholder,
        captionAudioHint: learnerDict.captionAudioHint,
        publish: learnerDict.publish,
        publishing: learnerDict.publishing,
      }}
    />
  );
  const captionsHeader = textToSpeechProvider.isConfigured && (
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
  );

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background">
      <SyncUiLanguage lang={lang} />
      <SessionAutoRefresh />
      <div className="flex min-h-0 flex-1 flex-col">
        <LiveSessionRoom
          sessionId={participant.session.id}
          role="learner"
          lang={lang}
          targetLanguage={participant.preferredLanguage}
          transcript={participant.session.transcript}
          messages={redactAnonymousSenders([...participant.session.messages].reverse())}
          sendChatAction={sendChatAction}
          allowQuestions
          title={resolvedTitle.hasTranslation ? resolvedTitle.text : getDictionary(lang).common.translationUnavailable}
          viewerUserId={participant.userId}
          canMessageFacilitatorPrivately
          currentLanguage={lang}
          onChangeLanguage={changeLanguageAction}
          languageOptions={learnerLanguageOptions}
          captionsHeader={captionsHeader}
          captionComposer={captionComposer}
        />
      </div>
    </div>
  );
}
