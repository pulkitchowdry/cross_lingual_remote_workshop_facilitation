import type { Metadata } from "next";
import { LiveSessionRoom } from "@/components/LiveSessionRoom";
import { CaptionPublishForm } from "@/components/CaptionPublishForm";
import { TranslatedAudioPlayer } from "@/components/TranslatedAudioPlayer";
import { LiveCaptionStream } from "@/components/LiveCaptionStream";
import { agentCaptureEnabled, browserCaptureDisabled } from "@/lib/caption-capture-mode";
import { SessionAutoRefresh } from "@/components/SessionAutoRefresh";
import { SyncUiLanguage } from "@/components/SyncUiLanguage";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ParticipantRole, SessionStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { hasFacilitatorAccess } from "@/lib/session-access";
import { facilitatorSpeakerId } from "@/lib/speaker-resolution";
import { resolveAppUrl } from "@/lib/env";
import { learnerInviteCookieName } from "@/lib/session-security";
import { getDictionary, resolveLanguage } from "@/lib/i18n";
import { textToSpeechProvider } from "@/lib/providers/text-to-speech";
import { sendChatMessage } from "@/app/sessions/actions";
import { publishCaption, updateFacilitatorLanguage } from "@/app/sessions/[sessionId]/facilitator/actions";
import { visibleSessionMessageWhere } from "@/lib/message-visibility";
import { buildFacilitatorAnalyticsView } from "@/lib/facilitator-analytics-view";
import { MESSAGE_HISTORY_LIMIT, TRANSCRIPT_HISTORY_LIMIT } from "@/lib/session-contracts";

export const metadata: Metadata = { title: "Live session" };

/**
 * Full-page takeover for the live meeting itself (see the dashboard page for
 * everything else: intervention queue, transcript history, QR invite). Only
 * reachable while the session is LIVE — `startSession` redirects the
 * facilitator straight here, and the dashboard's "Join live session" card
 * covers returning to an already-running one.
 */
export default async function FacilitatorRoomPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  if (!(await hasFacilitatorAccess(sessionId))) redirect("/setup");

  // Queried before the main fetch below purely to get `facilitatorId` for the messages
  // `where` filter — that filter has to be part of the same query that builds
  // `chatMessages`, so the id it depends on has to already be in hand first.
  const accessSession = await prisma.session.findUnique({ where: { id: sessionId }, select: { facilitatorId: true } });
  if (!accessSession) notFound();

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      // Needed for TranslatedAudioPlayer's viewerSpeakerId below — matches how
      // TranscriptSegment.speakerId is persisted for the facilitator's own segments
      // (facilitatorSpeakerId), so the facilitator's own captions never play back to them.
      facilitator: { select: { displayName: true } },
      // Capped + reversed the same way as the dashboard page (facilitator/page.tsx) —
      // see its own comments on TRANSCRIPT_HISTORY_LIMIT/MESSAGE_HISTORY_LIMIT for why:
      // this query re-runs every 2s for the whole LIVE session via SessionAutoRefresh, so
      // an uncapped transcript/messages history here grew without bound over a session's
      // lifetime instead of staying bounded like every other page's equivalent query.
      transcript: {
        include: { translations: true },
        orderBy: [{ startedAt: "desc" }, { id: "desc" }],
        take: TRANSCRIPT_HISTORY_LIMIT,
      },
      messages: {
        where: visibleSessionMessageWhere(sessionId, accessSession.facilitatorId),
        include: { sender: true, translations: true },
        orderBy: [{ sentAt: "desc" }, { id: "desc" }],
        take: MESSAGE_HISTORY_LIMIT,
      },
      participants: { where: { role: ParticipantRole.LEARNER }, include: { user: true } },
    },
  });
  if (!session) notFound();
  if (session.status !== SessionStatus.LIVE) redirect(`/sessions/${sessionId}/facilitator`);
  // transcript is now fetched newest-first (see the `take` cap above) — reversed here to
  // chronological (oldest-first) order, since CaptionOverlay/TranslationHistoryTab/
  // TranslatedAudioPlayer below all expect that order (e.g. CaptionOverlay treats the
  // LAST array entry as "most recent").
  const orderedTranscript = [...session.transcript].reverse();

  const lang = resolveLanguage(session.sourceLanguage);
  const dict = getDictionary(lang).facilitator;
  // Same view-model the dashboard (facilitator/page.tsx) computes — see that module's
  // doc comment: without this, a facilitator saw no analytics at all for the entire
  // duration of a live session, since `startSession` redirects them straight here and
  // away from the only page that used to render it.
  const analyticsView = await buildFacilitatorAnalyticsView(sessionId, session, lang);
  const sendChatAction = sendChatMessage.bind(null, sessionId, "facilitator");
  const changeLanguageAction = updateFacilitatorLanguage.bind(null, sessionId);
  const publishCaptionAction = publishCaption.bind(null, sessionId);
  const chatMessages = [...session.messages].reverse();
  const privateRecipientOptions = session.participants.map((participant) => ({
    participantId: participant.id,
    userId: participant.userId,
    displayName: participant.user.displayName,
  }));
  const captionComposer = (
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
  );
  const captionsHeader = (
    <>
      {/* Two independent reasons the agent may own this audio: it has actually started
          capturing (`captionAgentActive`, set by the worker at runtime), or this
          deployment assigns the facilitator to the agent unconditionally
          (`CAPTION_CAPTURE_MODE` — see caption-capture-mode.ts). The static one matters
          before the worker's job dispatch has landed, which is exactly the window where
          this component would otherwise open a competing stream. */}
      <LiveCaptionStream sessionId={session.id} lang={lang} agentCapturing={browserCaptureDisabled("facilitator") || (agentCaptureEnabled() && session.captionAgentActive)} />
      {textToSpeechProvider.isConfigured ? (
        <TranslatedAudioPlayer
          segments={orderedTranscript.map((segment) => ({
            id: segment.id,
            hasTranslation:
              segment.language === session.sourceLanguage ||
              segment.translations.some((item) => item.targetLanguage === session.sourceLanguage),
            isTyped: segment.isTyped,
            language: segment.language,
            speakerId: segment.speakerId,
          }))}
          preferredLanguage={session.sourceLanguage}
          viewerSpeakerId={facilitatorSpeakerId(session.facilitator.displayName)}
        />
      ) : (
        <p className="text-xs text-muted-foreground">{getDictionary(lang).learner.audioUnavailable}</p>
      )}
    </>
  );

  const appUrl = resolveAppUrl(await headers());
  const learnerToken = (await cookies()).get(learnerInviteCookieName(sessionId))?.value;
  const inviteLink = learnerToken ? `${appUrl}/join/${learnerToken}` : null;

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background">
      <SyncUiLanguage lang={lang} />
      <SessionAutoRefresh />
      <div className="flex min-h-0 flex-1 flex-col">
        <LiveSessionRoom
          sessionId={session.id}
          role="facilitator"
          lang={lang}
          targetLanguage={session.sourceLanguage}
          transcript={orderedTranscript}
          messages={chatMessages}
          sendChatAction={sendChatAction}
          title={session.title}
          inviteLink={inviteLink}
          viewerIsFacilitator
          viewerUserId={session.facilitatorId}
          privateRecipientOptions={privateRecipientOptions}
          currentLanguage={lang}
          facilitatorSourceLanguage={lang}
          ttsConfigured={textToSpeechProvider.isConfigured}
          onChangeLanguage={changeLanguageAction}
          captionsHeader={captionsHeader}
          captionComposer={captionComposer}
          analyticsView={analyticsView}
        />
      </div>
    </div>
  );
}
