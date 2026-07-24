import { Card } from "@/components/ui/Card";
import { LiveSessionRoom } from "@/components/LiveSessionRoom";
import { SessionAutoRefresh } from "@/components/SessionAutoRefresh";
import { SessionChatPanel } from "@/components/SessionChatPanel";
import { TranslatedAudioPlayer } from "@/components/TranslatedAudioPlayer";
import { notFound, redirect } from "next/navigation";
import { ParticipantRole, SessionStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { learnerParticipantId } from "@/lib/session-access";
import { textToSpeechProvider } from "@/lib/providers/text-to-speech";
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
          messages: { include: { sender: true, translations: true }, orderBy: { sentAt: "desc" } },
        },
      },
      user: true,
    },
  });
  if (!participant) notFound();
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
              allowQuestions
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
              : participant.session.status === SessionStatus.ENDED
                ? "Session ended"
                : "Waiting for the facilitator to start"}
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
                : (translation?.text ?? "Translation unavailable.");
              // "Translation unavailable." is a fixed English UI string, not a translation —
              // tag it "en" rather than the learner's preferred language.
              const primaryLang = isOwnLanguage ? segment.language : translation ? participant.preferredLanguage : "en";
              return (
                <Card key={segment.id} title={segment.speakerId ?? "Speaker"} meta={segment.language.toUpperCase()}>
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
          <Card eyebrow="Caption stream">
            <p className="text-muted-foreground">
              Captions will appear here as soon as the facilitator starts speaking.
            </p>
          </Card>
        )}
      </section>
    </div>
  );
}
