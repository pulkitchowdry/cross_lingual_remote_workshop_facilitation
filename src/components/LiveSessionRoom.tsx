"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ControlBar,
  GridLayout,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  TrackLoop,
  useDataChannel,
  useTracks,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { Track } from "livekit-client";

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

function WorkshopVideoStage() {
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 overflow-hidden p-3">
        <GridLayout tracks={tracks} className="h-full">
          <TrackLoop tracks={tracks}>
            <ParticipantTile />
          </TrackLoop>
        </GridLayout>
      </div>
      <div className="border-t border-border-subtle p-2">
        <ControlBar controls={{ microphone: true, camera: true, chat: false, screenShare: true, leave: true }} />
      </div>
    </div>
  );
}

export function LiveSessionRoom({ sessionId, role }: { sessionId: string; role: Role }) {
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
        if (!response.ok) throw new Error(payload.error ?? "Unable to join the media room.");
        if (!cancelled) setCredentials(payload);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Unable to join the media room.");
      }
    }
    void loadCredentials();
    return () => {
      cancelled = true;
    };
  }, [role, sessionId]);

  if (error) {
    return <p className="text-sm" style={{ color: "var(--tick-low)" }}>{error}</p>;
  }
  if (!credentials) {
    return <p className="text-sm text-muted-foreground">Connecting your secure audio/video room…</p>;
  }

  return (
    <div className="h-[38rem] overflow-hidden rounded-lg border border-border-subtle bg-surface">
      <LiveKitRoom
        token={credentials.token}
        serverUrl={credentials.serverUrl}
        connect
        audio
        video
        data-lk-theme="default"
      >
        <WorkshopVideoStage />
        <RoomAudioRenderer />
        <CaptionChannelRefresher />
      </LiveKitRoom>
    </div>
  );
}
