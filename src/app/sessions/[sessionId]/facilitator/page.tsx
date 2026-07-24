import QRCode from "qrcode";
import { Card } from "@/components/ui/Card";
import { LiveSessionRoom } from "@/components/LiveSessionRoom";
import { SessionAutoRefresh } from "@/components/SessionAutoRefresh";
import { SessionChatPanel } from "@/components/SessionChatPanel";
import { LiveCaptionStream } from "@/components/LiveCaptionStream";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ParticipantRole, SessionStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { learnerInviteCookieName } from "@/lib/session-security";
import { hasFacilitatorAccess } from "@/lib/session-access";
import { speechToTextProvider } from "@/lib/providers/speech-to-text";
import {
  endSession,
  loadDemoScenario,
  publishCaption,
  startSession,
} from "@/app/sessions/[sessionId]/facilitator/actions";
import { sendChatMessage } from "@/app/sessions/actions";

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
      },
    },
  });
  if (!session) notFound();

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
  const publishCaptionAction = publishCaption.bind(null, sessionId);
  const sendChatAction = sendChatMessage.bind(null, sessionId, "facilitator");
  const activeBlockers = session.insights.filter((insight) => insight.type === "BLOCKER");
  const chatMessages = [...session.messages].reverse();

  return (
    <div className="flex flex-col gap-6">
      {session.status === SessionStatus.LIVE && <SessionAutoRefresh />}
      <div>
        <p className="font-data text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Session created
        </p>
        <h1 className="font-heading text-2xl font-semibold">{session.title}</h1>
        <p className="text-sm text-muted-foreground">
          Invite learners first, then start live captions and the intervention dashboard.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span
          className="font-data rounded-full border border-border-strong px-2.5 py-1 text-xs font-medium uppercase tracking-wider"
          style={{ color: session.status === SessionStatus.LIVE ? "var(--tick-high)" : "var(--muted-foreground)" }}
        >
          {session.status.toLowerCase()}
        </span>
        {session.status === SessionStatus.DRAFT && (
          <form action={startAction}>
            <button className="font-data rounded-md bg-accent px-5 py-2 text-xs font-medium uppercase tracking-wider text-accent-foreground">
              Start session
            </button>
          </form>
        )}
        {session.status === SessionStatus.LIVE && (
          <form action={endAction}>
            <button className="font-data rounded-md border border-border-strong px-5 py-2 text-xs font-medium uppercase tracking-wider text-foreground">
              End session
            </button>
          </form>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card eyebrow="Workshop goal">{session.goal}</Card>
        <Card eyebrow="Learners joined">
          <span className="font-heading text-3xl font-semibold">{session.participants.length}</span>
          <p className="mt-1 text-sm text-muted-foreground">Learners have completed consent and joined.</p>
        </Card>
      </div>
      {session.status === SessionStatus.LIVE && (
        <section className="flex flex-col gap-3">
          <div>
            <p className="font-data text-xs font-medium uppercase tracking-wider text-muted-foreground">Workshop room</p>
            <h2 className="font-heading text-lg font-semibold">Live audio and video</h2>
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="flex flex-col gap-3">
              <LiveSessionRoom sessionId={session.id} role="facilitator" />
              <form action={publishCaptionAction} className="flex gap-2">
                <label className="sr-only" htmlFor="facilitator-caption">Type a caption for learners</label>
                <textarea
                  id="facilitator-caption"
                  className="flex-1 resize-none rounded-md border border-border-strong bg-surface-raised p-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
                  name="captionText"
                  rows={1}
                  required
                  maxLength={3000}
                  placeholder="Type a caption for learners in their selected language…"
                />
                <button className="font-data shrink-0 rounded-md border border-border-strong px-4 py-2 text-xs font-medium uppercase tracking-wider text-foreground">
                  Publish
                </button>
              </form>
              {speechToTextProvider.isConfigured && <LiveCaptionStream sessionId={session.id} />}
            </div>
            <SessionChatPanel
              messages={chatMessages}
              targetLanguage={session.sourceLanguage}
              sendAction={sendChatAction}
            />
          </div>
        </section>
      )}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-data text-xs font-medium uppercase tracking-wider text-muted-foreground">Act now</p>
            <h2 className="font-heading text-lg font-semibold">Evidence-backed intervention queue</h2>
          </div>
          {session.transcript.length === 0 && (
            <form action={demoAction}>
              <button className="font-data rounded-md border border-border-strong px-4 py-2 text-xs font-medium uppercase tracking-wider text-foreground">
                Load demo scenario
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
                : (translation?.text ?? "Translation unavailable.");
              return (
                <Card key={blocker.id} eyebrow="Blocker" accent="var(--tick-low)">
                  <p>{blocker.summary}</p>
                  {evidence && (
                    <p className="mt-2 rounded-md border border-border-subtle bg-background p-2 text-xs italic text-muted-foreground">
                      “{evidenceText}”
                    </p>
                  )}
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>Suggested action: ask the group to test whether `validateEmail()` throws.</span>
                  </div>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card eyebrow="No intervention needed yet">
            <p className="text-muted-foreground">Load the demo scenario to test the grounded intervention experience.</p>
          </Card>
        )}
      </section>
      <section className="flex flex-col gap-3">
        <div>
          <p className="font-data text-xs font-medium uppercase tracking-wider text-muted-foreground">Live transcript</p>
          <h2 className="font-heading text-lg font-semibold">What the group is saying</h2>
        </div>
        {session.transcript.length > 0 ? (
          <div className="flex flex-col gap-3">
            {session.transcript.map((segment) => {
              const translation = segment.translations.find((item) => item.targetLanguage === session.sourceLanguage);
              return (
                <Card key={segment.id} title={segment.speakerId ?? "Speaker"} meta={segment.language.toUpperCase()}>
                  <p className="italic text-muted-foreground">{segment.originalText}</p>
                  {translation && <p className="mt-2">{translation.text}</p>}
                </Card>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Captions will arrive here when the session is live.</p>
        )}
      </section>
      <Card eyebrow="Learner invitation" title="Share this private link">
        {learnerLink ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            {learnerLinkQrCode && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt="QR code for the learner invitation link"
                className="h-24 w-24 rounded-md border border-border-strong bg-white p-1"
                height={96}
                src={learnerLinkQrCode}
                width={96}
              />
            )}
            <div className="flex flex-1 flex-col gap-2">
              <p className="text-muted-foreground">
                Learners will choose a language and consent before entering the session. Scan the QR code or share the
                link below.
              </p>
              <input
                aria-label="Learner invitation link"
                className="w-full rounded-md border border-border-strong bg-background px-3 py-2 font-data text-xs text-foreground"
                readOnly
                value={learnerLink}
              />
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground">
            This browser no longer has the original learner link. Create a replacement invitation before sharing the session.
          </p>
        )}
      </Card>
      <Card eyebrow="What&apos;s next" title="Live learning workspace">
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-muted-foreground">
          <li>Start the session and connect live captions.</li>
          <li>Show translated captions in each learner&apos;s chosen language.</li>
          <li>Enable the evidence-backed intervention queue for the facilitator.</li>
        </ol>
      </Card>
    </div>
  );
}
