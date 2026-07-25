"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DisconnectButton,
  GridLayout,
  LeaveIcon,
  LiveKitRoom,
  MediaDeviceMenu,
  ParticipantTile,
  RoomAudioRenderer,
  TrackToggle,
  useDataChannel,
  useTracks,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { Track } from "livekit-client";
import { getDictionary } from "@/lib/i18n";
import type { SupportedLanguage } from "@/lib/session-contracts";

type RoomDict = ReturnType<typeof getDictionary>["room"];

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

function WorkshopVideoStage({ dict }: { dict: RoomDict }) {
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 overflow-hidden rounded-t-lg p-3">
        <GridLayout tracks={tracks} className="h-full">
          <ParticipantTile />
        </GridLayout>
      </div>
      <div className="relative z-10 flex flex-wrap items-center justify-center gap-2 border-t border-border-subtle p-2">
        <div className="lk-button-group">
          <TrackToggle source={Track.Source.Microphone} aria-label={dict.toggleMicrophone} />
          <div className="lk-button-group-menu">
            <MediaDeviceMenu kind="audioinput" aria-label={dict.selectMicrophone} />
          </div>
        </div>
        <div className="lk-button-group">
          <TrackToggle source={Track.Source.Camera} aria-label={dict.toggleCamera} />
          <div className="lk-button-group-menu">
            <MediaDeviceMenu kind="videoinput" aria-label={dict.selectCamera} />
          </div>
        </div>
        <TrackToggle source={Track.Source.ScreenShare} aria-label={dict.toggleScreenShare} />
        <DisconnectButton aria-label={dict.leaveCall}>
          <LeaveIcon />
        </DisconnectButton>
      </div>
    </div>
  );
}

export function LiveSessionRoom({ sessionId, role, lang }: { sessionId: string; role: Role; lang: SupportedLanguage }) {
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

  return (
    <div className="h-[38rem] rounded-lg border border-border-subtle bg-surface">
      <LiveKitRoom
        token={credentials.token}
        serverUrl={credentials.serverUrl}
        connect
        audio
        video={false}
        data-lk-theme="default"
      >
        <WorkshopVideoStage dict={dict} />
        <RoomAudioRenderer />
        <CaptionChannelRefresher />
      </LiveKitRoom>
    </div>
  );
}
