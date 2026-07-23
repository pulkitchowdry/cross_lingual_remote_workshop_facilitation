import { Card } from "@/components/ui/Card";
import { LiveSessionRoom } from "@/components/LiveSessionRoom";
import { SessionAutoRefresh } from "@/components/SessionAutoRefresh";
import { SessionChatPanel } from "@/components/SessionChatPanel";
import { notFound, redirect } from "next/navigation";
import { ParticipantRole, SessionStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { learnerParticipantId } from "@/lib/session-access";
import { askFacilitator } from "@/app/sessions/[sessionId]/learn/actions";
import { sendChatMessage } from "@/app/sessions/actions";

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
          messages: { where: { kind: "CHAT" }, include: { sender: true, translations: true }, orderBy: { sentAt: "desc" } },
        },
      },
      user: true,
    },
  });
  if (!participant) notFound();
  const questionAction = askFacilitator.bind(null, sessionId);
  const sendChatAction = sendChatMessage.bind(null, sessionId, "learner");

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {participant.session.status === SessionStatus.LIVE && <SessionAutoRefresh />}
      <div>
        <p className="font-data text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Welcome, {participant.user.displayName}
        </p>
        <h1 className="font-heading text-2xl font-semibold">{participant.session.title}</h1>
        <p className="text-sm text-muted-foreground">
          Your captions and facilitator replies will appear in your selected language.
        </p>
      </div>
      <Card eyebrow="Your learning preferences">
        <p>
          Preferred language: <strong>{participant.preferredLanguage}</strong>
        </p>
      </Card>
      {participant.session.status === SessionStatus.LIVE && (
        <section className="flex flex-col gap-3">
          <div>
            <p className="font-data text-xs font-medium uppercase tracking-wider text-muted-foreground">Workshop room</p>
            <h2 className="font-heading text-lg font-semibold">Live audio and video</h2>
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <LiveSessionRoom sessionId={participant.session.id} role="learner" />
            <SessionChatPanel
              messages={[...participant.session.messages].reverse()}
              targetLanguage={participant.preferredLanguage}
              sendAction={sendChatAction}
            />
          </div>
        </section>
      )}
      <section className="flex flex-col gap-3" aria-live="polite">
        <div>
          <p className="font-data text-xs font-medium uppercase tracking-wider text-muted-foreground">Live captions</p>
          <h2 className="font-heading text-lg font-semibold">
            {participant.session.status === SessionStatus.LIVE
              ? "Follow the explanation in your language"
              : "Waiting for the facilitator to start"}
          </h2>
        </div>
        {participant.session.transcript.length > 0 ? (
          <div className="flex flex-col gap-3">
            {participant.session.transcript.map((segment) => {
              const translation = segment.translations.find(
                (item) => item.targetLanguage === participant.preferredLanguage,
              );
              return (
                <Card key={segment.id} title={segment.speakerId ?? "Speaker"} meta={segment.language.toUpperCase()}>
                  <p className="text-base leading-relaxed">{translation?.text ?? segment.originalText}</p>
                  {translation && (
                    <p className="mt-2 text-xs italic text-muted-foreground" lang={segment.language}>
                      {segment.originalText}
                    </p>
                  )}
                </Card>
              );
            })}
          </div>
        ) : (
          <Card eyebrow="Caption stream">
            <p className="text-muted-foreground">
              Captions will appear here as soon as the facilitator starts speaking.
            </p>
          </Card>
        )}
      </section>
      <section className="flex flex-col gap-3 border-t border-border-subtle pt-6">
        <div>
          <p className="font-data text-xs font-medium uppercase tracking-wider text-muted-foreground">Participation</p>
          <h2 className="font-heading text-lg font-semibold">Ask the facilitator</h2>
          <p className="text-sm text-muted-foreground">
            Ask naturally in your selected language. The facilitator receives a translation when the translation provider is configured.
          </p>
        </div>
        <form action={questionAction} className="flex flex-col gap-2">
          <label className="flex flex-col gap-2 text-sm font-medium">
            Your question
            <textarea
              className="rounded-lg border border-border-strong bg-surface-raised p-3 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              name="question"
              rows={3}
              required
              maxLength={1000}
              placeholder="Type your question in your own language."
            />
          </label>
          <button className="font-data w-fit rounded-md bg-accent px-5 py-2 text-xs font-medium uppercase tracking-wider text-accent-foreground">
            Send question
          </button>
        </form>
      </section>
    </div>
  );
}
