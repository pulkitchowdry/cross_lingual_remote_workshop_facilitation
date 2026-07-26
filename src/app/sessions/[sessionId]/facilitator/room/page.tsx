import type { Metadata } from "next";
import { LiveSessionRoom } from "@/components/LiveSessionRoom";
import { LiveCaptionStream } from "@/components/LiveCaptionStream";
import { SessionAutoRefresh } from "@/components/SessionAutoRefresh";
import { SyncUiLanguage } from "@/components/SyncUiLanguage";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { SessionStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { hasFacilitatorAccess } from "@/lib/session-access";
import { learnerInviteCookieName } from "@/lib/session-security";
import { speechToTextProvider } from "@/lib/providers/speech-to-text";
import { getDictionary, resolveLanguage } from "@/lib/i18n";
import { publishCaption } from "@/app/sessions/[sessionId]/facilitator/actions";
import { sendChatMessage } from "@/app/sessions/actions";
import { CaptionPublishForm } from "@/components/CaptionPublishForm";

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

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      transcript: { include: { translations: true }, orderBy: { startedAt: "asc" } },
      messages: { include: { sender: true, translations: true }, orderBy: { sentAt: "desc" } },
    },
  });
  if (!session) notFound();
  if (session.status !== SessionStatus.LIVE) redirect(`/sessions/${sessionId}/facilitator`);

  const lang = resolveLanguage(session.sourceLanguage);
  const dict = getDictionary(lang).facilitator;
  const publishCaptionAction = publishCaption.bind(null, sessionId);
  const sendChatAction = sendChatMessage.bind(null, sessionId, "facilitator");
  const chatMessages = [...session.messages].reverse();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
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
          transcript={session.transcript}
          messages={chatMessages}
          sendChatAction={sendChatAction}
          title={session.title}
          inviteLink={inviteLink}
        />
      </div>
      {/* Removing this part as its not necessary and might be removed in the long run */}
      {/* <div className="flex shrink-0 flex-col gap-2 border-t border-border-subtle bg-surface p-3">
        <CaptionPublishForm
          action={publishCaptionAction}
          dict={{
            captionLabel: dict.captionLabel,
            captionPlaceholder: dict.captionPlaceholder,
            publish: dict.publish,
            publishing: dict.publishing,
          }}
        />
        {speechToTextProvider.isConfigured && <LiveCaptionStream sessionId={session.id} lang={lang} />}
      </div> */}
    </div>
  );
}
