"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CarouselLayout,
  ControlBar,
  FocusLayout,
  FocusLayoutContainer,
  GridLayout,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useDataChannel,
  useTracks,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { Track } from "livekit-client";
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

/**
 * Only the facilitator's ControlBar exposes the screen-share toggle — the
 * room stays bidirectional for audio/video (see room.ts), but screen sharing
 * is a facilitator-to-group broadcast, not a peer-to-peer one, so learners
 * don't get the control.
 */
function WorkshopVideoStage({ role }: { role: Role }) {
  const tracks = useTracks([
    { source: Track.Source.Camera, withPlaceholder: true },
    { source: Track.Source.ScreenShare, withPlaceholder: false },
  ]);
  const screenShareTrack = tracks.find((track) => track.source === Track.Source.ScreenShare);
  const cameraTracks = tracks.filter((track) => track.source === Track.Source.Camera);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 overflow-hidden p-3">
        {screenShareTrack ? (
          <FocusLayoutContainer className="h-full">
            <FocusLayout trackRef={screenShareTrack} />
            <CarouselLayout tracks={cameraTracks}>
              <ParticipantTile />
            </CarouselLayout>
          </FocusLayoutContainer>
        ) : (
          <GridLayout tracks={cameraTracks} className="h-full">
            <ParticipantTile />
          </GridLayout>
        )}
      </div>
      <div className="overflow-x-auto border-t border-border-subtle p-2">
        <ControlBar
          variation="minimal"
          controls={{ microphone: true, camera: true, chat: false, screenShare: role === "facilitator", leave: true }}
        />
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
    <div className="h-[38rem] overflow-hidden rounded-lg border border-border-subtle bg-surface">
      <LiveKitRoom
        token={credentials.token}
        serverUrl={credentials.serverUrl}
        connect
        audio
        video={false}
        data-lk-theme="default"
      >
        <WorkshopVideoStage role={role} />
        <RoomAudioRenderer />
        <CaptionChannelRefresher />
      </LiveKitRoom>
    </div>
  );
}
