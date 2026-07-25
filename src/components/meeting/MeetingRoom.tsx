"use client";

import { useRef } from "react";
import { FocusLayout, useRoomInfo, useTracks } from "@livekit/components-react";
import { Track } from "livekit-client";
import { MeetingShellProvider, useMeetingShell } from "@/components/meeting/MeetingShellContext";
import { MeetingToolbar } from "@/components/meeting/MeetingToolbar";
import { ParticipantStrip } from "@/components/meeting/ParticipantStrip";
import { ParticipantGrid } from "@/components/meeting/ParticipantGrid";
import { MeetingSidebar } from "@/components/meeting/MeetingSidebar";
import { CaptionOverlay } from "@/components/meeting/CaptionOverlay";
import { Whiteboard } from "@/components/meeting/Whiteboard";
import { AutoPictureInPicture } from "@/components/meeting/AutoPictureInPicture";
import { MeetingHeader } from "@/components/meeting/MeetingHeader";
import { parseRoomMetadata } from "@/components/meeting/room-metadata";
import type { MeetingChatMessage, MeetingTranscriptSegment } from "@/components/meeting/types";
import type { SupportedLanguage } from "@/lib/session-contracts";

type Role = "facilitator" | "learner";

function MeetingRoomInner({
  sessionId,
  role,
  uiLang,
  targetLanguage,
  transcript,
  messages,
  sendChatAction,
  allowQuestions,
  dashboardHref,
  title,
  inviteLink,
}: {
  sessionId: string;
  role: Role;
  uiLang: SupportedLanguage;
  targetLanguage: string;
  transcript: MeetingTranscriptSegment[];
  messages: MeetingChatMessage[];
  sendChatAction: (formData: FormData) => void | Promise<void>;
  allowQuestions?: boolean;
  dashboardHref: string;
  title: string;
  inviteLink?: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { workspaceMode } = useMeetingShell();
  const { metadata } = useRoomInfo();
  const { allowLearnerPresenting } = parseRoomMetadata(metadata);
  const canPresent = role === "facilitator" || allowLearnerPresenting;

  const tracks = useTracks([
    { source: Track.Source.Camera, withPlaceholder: true },
    { source: Track.Source.Microphone, withPlaceholder: true },
    { source: Track.Source.ScreenShare, withPlaceholder: false },
  ]);
  const screenShareTrack = tracks.find((track) => track.source === Track.Source.ScreenShare);
  const cameraTracks = tracks.filter((track) => track.source === Track.Source.Camera);
  const micTracks = tracks.filter((track) => track.source === Track.Source.Microphone);
  const focusMode = Boolean(screenShareTrack) || workspaceMode === "whiteboard";
  // What a floating Picture-in-Picture window (see AutoPictureInPicture) should mirror while the
  // user is tabbed away: the shared screen if there is one, otherwise the local camera — a plain
  // "you're still on this call" indicator rather than trying to track the active speaker.
  const primaryTrack = screenShareTrack ?? cameraTracks.find((track) => track.participant.isLocal);

  return (
    <div ref={containerRef} className="flex h-full min-h-0 flex-col" tabIndex={-1}>
      <AutoPictureInPicture primaryTrack={primaryTrack} />
      <MeetingHeader title={title} inviteLink={inviteLink} uiLang={uiLang} />
      <div className="flex min-h-0 flex-1 gap-3 p-3">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border-subtle">
          {focusMode && <ParticipantStrip uiLang={uiLang} cameraTracks={cameraTracks} micTracks={micTracks} />}
          <div className="relative min-h-0 flex-1">
            {workspaceMode === "whiteboard" ? (
              <Whiteboard sessionId={sessionId} uiLang={uiLang} canPresent={canPresent} />
            ) : screenShareTrack ? (
              <FocusLayout trackRef={screenShareTrack} className="h-full w-full" />
            ) : (
              <ParticipantGrid uiLang={uiLang} cameraTracks={cameraTracks} micTracks={micTracks} />
            )}
            <CaptionOverlay transcript={transcript} uiLang={uiLang} />
          </div>
        </div>
        <MeetingSidebar uiLang={uiLang} targetLanguage={targetLanguage} messages={messages} sendChatAction={sendChatAction} allowQuestions={allowQuestions} />
      </div>
      <div className="flex justify-center border-t border-border-subtle p-2">
        <MeetingToolbar
          sessionId={sessionId}
          role={role}
          uiLang={uiLang}
          canPresent={canPresent}
          allowLearnerPresenting={allowLearnerPresenting}
          containerRef={containerRef}
          dashboardHref={dashboardHref}
        />
      </div>
    </div>
  );
}

export function MeetingRoom(props: {
  sessionId: string;
  role: Role;
  uiLang: SupportedLanguage;
  targetLanguage: string;
  transcript: MeetingTranscriptSegment[];
  messages: MeetingChatMessage[];
  sendChatAction: (formData: FormData) => void | Promise<void>;
  allowQuestions?: boolean;
  dashboardHref: string;
  title: string;
  inviteLink?: string | null;
}) {
  return (
    <MeetingShellProvider>
      <MeetingRoomInner {...props} />
    </MeetingShellProvider>
  );
}
