import type { Metadata } from "next";
import QRCode from "qrcode";
import { Card } from "@/components/ui/Card";
import { LiveSessionRoom } from "@/components/LiveSessionRoom";
import { SessionAutoRefresh } from "@/components/SessionAutoRefresh";
import { SessionChatPanel } from "@/components/SessionChatPanel";
import { LiveCaptionStream } from "@/components/LiveCaptionStream";
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
import { getDictionary, resolveLanguage } from "@/lib/i18n";
import { MESSAGE_HISTORY_LIMIT } from "@/lib/session-contracts";
import { isSessionRetentionExpired } from "@/lib/session-retention";
import {
  endSession,
  publishCaption,
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

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      participants: { where: { role: ParticipantRole.LEARNER } },
      transcript: { include: { translations: true }, orderBy: { startedAt: "asc" } },
      insights: { include: { evidence: { include: { transcriptSegment: { include: { translations: true } } } } } },
      messages: {
        include: { sender: true, translations: true },
        orderBy: { sentAt: "desc" },
        take: MESSAGE_HISTORY_LIMIT,
      },
      joinLinks: { where: { role: ParticipantRole.LEARNER } },
    },
  });
  if (!session) notFound();
  // The hourly cleanup cron (retention/cleanup/route.ts) physically deletes an
  // expired session's data, but nothing stops it being served here in the
  // meantime — up to an hour after its own retention deadline, or indefinitely
  // if the cron never runs (e.g. CRON_SECRET was never set). Treat it as gone
  // as soon as it's due, not just once the delete has actually happened.
  if (isSessionRetentionExpired(session)) notFound();

  const lang = resolveLanguage(session.sourceLanguage);
  const dict = getDictionary(lang).facilitator;
  const statusLabel = {
    [SessionStatus.DRAFT]: dict.statusDraft,
    [SessionStatus.LIVE]: dict.statusLive,
    [SessionStatus.ENDED]: dict.statusEnded,
  }[session.status];

  const appUrl  = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
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
  const activeBlockers = session.insights.filter((insight) => insight.type === "BLOCKER");
  const chatMessages = [...session.messages].reverse();
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
            <button className="font-data rounded-md bg-accent px-5 py-2 text-xs font-medium uppercase tracking-wider text-accent-foreground">
              {dict.startSession}
            </button>
          </form>
        )}
        {session.status === SessionStatus.LIVE && (
          <form action={endAction}>
            <button className="font-data rounded-md border border-border-strong px-5 py-2 text-xs font-medium uppercase tracking-wider text-foreground">
              {dict.endSession}
            </button>
          </form>
        )}
        <span className="font-data text-xs text-muted-foreground" title={dict.learnersJoinedHint}>
          {session.participants.length} {dict.learnersJoinedCard.toLowerCase()}
        </span>
      </div>
      {session.status === SessionStatus.LIVE && (
        <section className="flex flex-col gap-3">
          <h2 className="font-data text-xs font-medium uppercase tracking-wider text-muted-foreground">{dict.workshopRoom}</h2>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
            <div className="flex flex-col gap-3">
              <LiveSessionRoom sessionId={session.id} role="facilitator" lang={lang} />
              <form action={publishCaptionAction} className="flex gap-2">
                <label className="sr-only" htmlFor="facilitator-caption">{dict.captionLabel}</label>
                <textarea
                  id="facilitator-caption"
                  className="flex-1 resize-none rounded-md border border-border-strong bg-surface-raised p-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
                  name="captionText"
                  rows={1}
                  required
                  maxLength={3000}
                  placeholder={dict.captionPlaceholder}
                />
                <button className="font-data shrink-0 rounded-md border border-border-strong px-4 py-2 text-xs font-medium uppercase tracking-wider text-foreground">
                  {dict.publish}
                </button>
              </form>
              {speechToTextProvider.isConfigured && (
                <LiveCaptionStream
                  sessionId={session.id}
                  lang={lang}
                  agentCapturing={session.captionAgentActive}
                />
              )}
            </div>
            <SessionChatPanel
              messages={chatMessages}
              targetLanguage={session.sourceLanguage}
              sendAction={sendChatAction}
            />
          </div>
        </section>
      )}
      <section className="flex flex-col gap-3" aria-live="polite">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-data text-xs font-medium uppercase tracking-wider text-muted-foreground">{dict.actNow}</h2>
        </div>
        {activeBlockers.length > 0 ? (
          <div className="flex flex-col gap-3">
            {activeBlockers.map((blocker) => {
              const evidence = blocker.evidence[0]?.transcriptSegment;
              const evidenceIsSourceLanguage = evidence?.language === session.sourceLanguage;
              const translation = evidence?.translations.find((item) => item.targetLanguage === session.sourceLanguage);
              const evidenceText = evidenceIsSourceLanguage
                ? evidence?.originalText
                : (translation?.text ?? getDictionary(lang).common.translationUnavailable);
              // The fallback text (getDictionary(lang).common.translationUnavailable above)
              // is itself localized to `lang`, not fixed English copy — tag it `lang`,
              // not "en".
              const evidenceLang = evidenceIsSourceLanguage ? evidence?.language : translation ? session.sourceLanguage : lang;
              return (
                <Card key={blocker.id} eyebrow={dict.blocker} accent="var(--tick-low)">
                  <p>{blocker.summary}</p>
                  {evidence && (
                    <p
                      className="mt-2 rounded-md border border-border-subtle bg-background p-2 text-xs italic text-muted-foreground"
                      lang={evidenceLang}
                    >
                      “{evidenceText}”
                    </p>
                  )}
                </Card>
              );
            })}
          </div>
        ) : session.transcript.length === 0 ? (
          <Card eyebrow={dict.noInterventionYet}>
            <p className="text-muted-foreground">{dict.noInterventionHintOnTrack}</p>
          </Card>
        ) : (
          <Card eyebrow={dict.noInterventionYet}>
            <p className="text-muted-foreground">{dict.noInterventionHintOnTrack}</p>
          </Card>
        )}
      </section>
      <section className="flex flex-col gap-3" aria-live="polite">
        <h2 className="font-data text-xs font-medium uppercase tracking-wider text-muted-foreground">{dict.liveTranscript}</h2>
        {session.transcript.length > 0 ? (
          <div className="flex flex-col gap-3">
            {session.transcript.map((segment) => {
              const translation = segment.translations.find((item) => item.targetLanguage === session.sourceLanguage);
              return (
                <Card key={segment.id} title={segment.speakerId ?? getDictionary(lang).common.speaker} meta={segment.language.toUpperCase()}>
                  <p className="italic text-muted-foreground" lang={segment.language}>
                    {segment.originalText}
                  </p>
                  {translation && (
                    <p className="mt-2" lang={session.sourceLanguage}>
                      {translation.text}
                    </p>
                  )}
                </Card>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{dict.transcriptEmpty}</p>
        )}
      </section>
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
              <button className="font-data w-fit rounded-md border border-border-strong px-4 py-2 text-xs font-medium uppercase tracking-wider text-foreground hover:border-[var(--tick-low)] hover:text-[var(--tick-low)]">
                {dict.revokeInvite}
              </button>
            </form>
          </div>
        ) : (
          <p className="text-muted-foreground">{dict.linkMissingMsg}</p>
        )}
      </Card>
    </div>
  );
}
