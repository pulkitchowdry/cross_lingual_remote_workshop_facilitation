import type { Metadata } from "next";
import Link from "next/link";
import QRCode from "qrcode";
import { Card } from "@/components/ui/Card";
import { SessionAutoRefresh } from "@/components/SessionAutoRefresh";
import { SyncUiLanguage } from "@/components/SyncUiLanguage";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ParticipantRole, SessionStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { learnerInviteCookieName } from "@/lib/session-security";
import { hasFacilitatorAccess } from "@/lib/session-access";
import { getDictionary, resolveLanguage } from "@/lib/i18n";
import {
  endSession,
  loadDemoScenario,
  logoutFacilitator,
  revokeLearnerInvite,
  startSession,
} from "@/app/sessions/[sessionId]/facilitator/actions";

export const metadata: Metadata = { title: "Facilitator dashboard" };

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
      joinLinks: { where: { role: ParticipantRole.LEARNER } },
    },
  });
  if (!session) notFound();

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
  const demoAction = loadDemoScenario.bind(null, sessionId);
  const revokeInviteAction = revokeLearnerInvite.bind(null, sessionId);
  const logoutAction = logoutFacilitator.bind(null, sessionId);
  const activeBlockers = session.insights.filter((insight) => insight.type === "BLOCKER");
  const learnerInviteRevoked = session.joinLinks.some((link) => link.revokedAt !== null);

  return (
    <div className="flex flex-col gap-6">
      <SyncUiLanguage lang={lang} />
      {session.status === SessionStatus.LIVE && <SessionAutoRefresh />}
      <div>
        <p className="font-data text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {dict.sessionCreated}
        </p>
        <h1 className="font-heading text-2xl font-semibold">{session.title}</h1>
        <p className="text-sm text-muted-foreground">{dict.subtitle}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3" aria-live="polite">
        <span
          className="font-data rounded-full border border-border-strong px-2.5 py-1 text-xs font-medium uppercase tracking-wider"
          style={{ color: session.status === SessionStatus.LIVE ? "var(--tick-high)" : "var(--muted-foreground)" }}
        >
          {statusLabel}
        </span>
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
        <form action={logoutAction}>
          <button className="font-data rounded-md border border-border-subtle px-5 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground">
            {dict.logOut}
          </button>
        </form>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card eyebrow={dict.workshopGoalCard}>{session.goal}</Card>
        <Card eyebrow={dict.learnersJoinedCard}>
          <span className="font-heading text-3xl font-semibold">{session.participants.length}</span>
          <p className="mt-1 text-sm text-muted-foreground">{dict.learnersJoinedHint}</p>
        </Card>
      </div>
      {session.status === SessionStatus.LIVE && (
        <Card eyebrow={dict.workshopRoom} title={dict.liveAudioVideo} accent="var(--tick-high)">
          <p className="text-muted-foreground">{dict.micCameraHint}</p>
          <Link
            href={`/sessions/${sessionId}/facilitator/room`}
            className="font-data mt-3 inline-block w-fit rounded-md bg-accent px-5 py-2 text-xs font-medium uppercase tracking-wider text-accent-foreground"
          >
            {getDictionary(lang).common.joinLiveSession}
          </Link>
        </Card>
      )}
      <section className="flex flex-col gap-3" aria-live="polite">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-data text-xs font-medium uppercase tracking-wider text-muted-foreground">{dict.actNow}</p>
            <h2 className="font-heading text-lg font-semibold">{dict.interventionQueue}</h2>
          </div>
          {session.transcript.length === 0 && (
            <form action={demoAction}>
              <button className="font-data rounded-md border border-border-strong px-4 py-2 text-xs font-medium uppercase tracking-wider text-foreground">
                {dict.loadDemo}
              </button>
            </form>
          )}
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
              const evidenceLang = evidenceIsSourceLanguage
                ? evidence?.language
                : translation
                  ? session.sourceLanguage
                  : "en";
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
            <p className="text-muted-foreground">{dict.noInterventionHintEmpty}</p>
          </Card>
        ) : (
          <Card eyebrow={dict.noInterventionYet}>
            <p className="text-muted-foreground">{dict.noInterventionHintOnTrack}</p>
          </Card>
        )}
      </section>
      <section className="flex flex-col gap-3" aria-live="polite">
        <div>
          <p className="font-data text-xs font-medium uppercase tracking-wider text-muted-foreground">{dict.liveTranscript}</p>
          <h2 className="font-heading text-lg font-semibold">{dict.whatGroupSaying}</h2>
        </div>
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
              <div className="flex flex-1 flex-col gap-2">
                <p className="text-muted-foreground">{dict.linkInstructions}</p>
                <input
                  aria-label={dict.learnerLinkAriaLabel}
                  className="w-full rounded-md border border-border-strong bg-background px-3 py-2 font-data text-xs text-foreground"
                  readOnly
                  value={learnerLink}
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
      <Card eyebrow={dict.whatsNext} title={dict.liveWorkspace}>
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-muted-foreground">
          <li>{dict.step1}</li>
          <li>{dict.step2}</li>
          <li>{dict.step3}</li>
        </ol>
      </Card>
    </div>
  );
}
