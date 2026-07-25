import type { Metadata } from "next";
import { LiveSessionRoom } from "@/components/LiveSessionRoom";
import { SessionAutoRefresh } from "@/components/SessionAutoRefresh";
import { SyncUiLanguage } from "@/components/SyncUiLanguage";
import { notFound, redirect } from "next/navigation";
import { ParticipantRole, SessionStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { learnerParticipantId } from "@/lib/session-access";
import { resolveLanguage } from "@/lib/i18n";
import { sendChatMessage } from "@/app/sessions/actions";

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

  const participant = await prisma.sessionParticipant.findFirst({
    where: { id: participantId, sessionId, role: ParticipantRole.LEARNER },
    include: {
      session: {
        include: {
          transcript: { include: { translations: true }, orderBy: { startedAt: "asc" } },
          messages: { include: { sender: true, translations: true }, orderBy: { sentAt: "desc" } },
        },
      },
    },
  });
  if (!participant) notFound();
  if (participant.session.status !== SessionStatus.LIVE) redirect(`/sessions/${sessionId}/learn`);

  const lang = resolveLanguage(participant.preferredLanguage);
  const sendChatAction = sendChatMessage.bind(null, sessionId, "learner");

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
          messages={[...participant.session.messages].reverse()}
          sendChatAction={sendChatAction}
          allowQuestions
          title={participant.session.title}
        />
      </div>
    </div>
  );
}
