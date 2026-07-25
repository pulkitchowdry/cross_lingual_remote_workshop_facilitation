"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LiveKitRoom, RoomAudioRenderer, useDataChannel } from "@livekit/components-react";
import "@livekit/components-styles";
import { MeetingRoom } from "@/components/meeting/MeetingRoom";
import type { MeetingChatMessage, MeetingTranscriptSegment } from "@/components/meeting/types";
import { getDictionary } from "@/lib/i18n";
import type { SupportedLanguage } from "@/lib/session-contracts";

/**
 * Refreshes the page as soon as a `notifyCaptionsChanged` DataChannel message
 * arrives, so captions land near-instantly instead of waiting for the next
 * `SessionAutoRefresh` poll. Must render inside `<LiveKitRoom>` to reach room
 * context; renders nothing itself.
 */
function CaptionChannelRefresher() {
  const router = useRouter();
  useDataChannel("captions", () => router.refresh());
  return null;
}

type Role = "facilitator" | "learner";

interface RoomCredentials {
  serverUrl: string;
  token: string;
}

export function LiveSessionRoom({
  sessionId,
  role,
  lang,
  targetLanguage,
  transcript,
  messages,
  sendChatAction,
  allowQuestions,
  title,
  inviteLink,
}: {
  sessionId: string;
  role: Role;
  lang: SupportedLanguage;
  targetLanguage: string;
  transcript: MeetingTranscriptSegment[];
  messages: MeetingChatMessage[];
  sendChatAction: (formData: FormData) => void | Promise<void>;
  allowQuestions?: boolean;
  title: string;
  inviteLink?: string | null;
}) {
  const dict = getDictionary(lang).room;
  const [credentials, setCredentials] = useState<RoomCredentials | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadCredentials() {
      try {
        const response = await fetch("/api/livekit/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, role }),
        });
        const payload = (await response.json()) as RoomCredentials & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? dict.unableToJoin);
        if (!cancelled) setCredentials(payload);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : dict.unableToJoin);
      }
    }
    void loadCredentials();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, sessionId]);

  if (error) {
    return <p className="text-sm" style={{ color: "var(--tick-low)" }}>{error}</p>;
  }
  if (!credentials) {
    return <p className="text-sm text-muted-foreground">{dict.connecting}</p>;
  }

  const dashboardHref = `/sessions/${sessionId}/${role === "facilitator" ? "facilitator" : "learn"}`;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-surface">
      <LiveKitRoom
        token={credentials.token}
        serverUrl={credentials.serverUrl}
        connect
        audio={false}
        video
        data-lk-theme="default"
        className="flex h-full min-h-0 flex-col"
      >
        <MeetingRoom
          sessionId={sessionId}
          role={role}
          uiLang={lang}
          targetLanguage={targetLanguage}
          transcript={transcript}
          messages={messages}
          sendChatAction={sendChatAction}
          allowQuestions={allowQuestions}
          dashboardHref={dashboardHref}
          title={title}
          inviteLink={inviteLink}
        />
        <RoomAudioRenderer />
        <CaptionChannelRefresher />
      </LiveKitRoom>
    </div>
  );
}
