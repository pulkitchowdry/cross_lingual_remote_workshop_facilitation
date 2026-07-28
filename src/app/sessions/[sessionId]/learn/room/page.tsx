import type { Metadata } from "next";
import { LiveSessionRoom } from "@/components/LiveSessionRoom";
import { CaptionPublishForm } from "@/components/CaptionPublishForm";
import { TranslatedAudioPlayer } from "@/components/TranslatedAudioPlayer";
import { LiveCaptionStream } from "@/components/LiveCaptionStream";
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
import { MESSAGE_HISTORY_LIMIT, SUPPORTED_LANGUAGES, TRANSCRIPT_HISTORY_LIMIT } from "@/lib/session-contracts";

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
  // Not `redirect("/setup")` — see the matching comment in learn/page.tsx. This page
  // also polls via SessionAutoRefresh every 2s while LIVE, so a cookie that evaporates
  // mid-call (device switch, storage eviction) would otherwise bounce a learner straight
  // out of the live meeting into the facilitator's session-creation form.
  if (!participantId) notFound();
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
          // Capped + reversed the same way as the dashboard page (learn/page.tsx) — see
          // facilitator/room/page.tsx's matching comment for why: this query re-runs every
          // 2s for the whole LIVE session via SessionAutoRefresh, so an uncapped transcript/
          // messages history here grew without bound over a session's lifetime instead of
          // staying bounded like every other page's equivalent query.
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
          translations: true,
        },
      },
    },
  });
  if (!participant) notFound();
  if (participant.session.status !== SessionStatus.LIVE) redirect(`/sessions/${sessionId}/learn`);
  // transcript is now fetched newest-first (see the `take` cap above) — reversed here to
  // chronological (oldest-first) order, since CaptionOverlay/TranslationHistoryTab/
  // TranslatedAudioPlayer below all expect that order (e.g. CaptionOverlay treats the
  // LAST array entry as "most recent").
  const orderedTranscript = [...participant.session.transcript].reverse();

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
  const captionsHeader = (
    <>
      {/* No `agentCapturing` prop, deliberately — unlike the facilitator, a learner's mic
          is never subscribed to by the server-side caption-agent worker at all (see that
          file's own top-level doc comment for why: it used to, and produced duplicate
          transcript segments alongside this same browser-based capture with no
          de-duplication anywhere in the pipeline). This is always the sole capture path
          for a learner's own speech, so the Start/Stop control always applies. */}
      <LiveCaptionStream sessionId={participant.session.id} lang={lang} />
      {textToSpeechProvider.isConfigured ? (
        <TranslatedAudioPlayer
          segments={orderedTranscript.map((segment) => ({
            id: segment.id,
            hasTranslation:
              segment.language === participant.preferredLanguage ||
              segment.translations.some((item) => item.targetLanguage === participant.preferredLanguage),
            isTyped: segment.isTyped,
            language: segment.language,
          }))}
          preferredLanguage={participant.preferredLanguage}
        />
      ) : (
        <p className="text-xs text-muted-foreground">{learnerDict.audioUnavailable}</p>
      )}
    </>
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
          transcript={orderedTranscript}
          messages={redactAnonymousSenders([...participant.session.messages].reverse())}
          sendChatAction={sendChatAction}
          allowQuestions
          title={resolvedTitle.hasTranslation ? resolvedTitle.text : getDictionary(lang).common.translationUnavailable}
          viewerUserId={participant.userId}
          canMessageFacilitatorPrivately
          currentLanguage={lang}
          facilitatorSourceLanguage={resolveLanguage(participant.session.sourceLanguage)}
          ttsConfigured={textToSpeechProvider.isConfigured}
          onChangeLanguage={changeLanguageAction}
          languageOptions={learnerLanguageOptions}
          captionsHeader={captionsHeader}
          captionComposer={captionComposer}
        />
      </div>
    </div>
  );
}
