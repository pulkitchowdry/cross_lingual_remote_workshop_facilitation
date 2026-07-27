"use client";

import { useRef, type ReactNode } from "react";
import { FocusLayout, useRoomInfo, useTracks } from "@livekit/components-react";
import { Track } from "livekit-client";
import { MeetingShellProvider, useMeetingShell } from "@/components/meeting/MeetingShellContext";
import { MeetingToolbar } from "@/components/meeting/MeetingToolbar";
import { ParticipantStrip } from "@/components/meeting/ParticipantStrip";
import { ParticipantGrid } from "@/components/meeting/ParticipantGrid";
import { MeetingSidebar } from "@/components/meeting/MeetingSidebar";
import { CaptionOverlay } from "@/components/meeting/CaptionOverlay";
import { RaisedHandAnnouncer } from "@/components/meeting/RaisedHandAnnouncer";
import { Whiteboard } from "@/components/meeting/Whiteboard";
import { AutoPictureInPicture } from "@/components/meeting/AutoPictureInPicture";
import { MeetingHeader } from "@/components/meeting/MeetingHeader";
import { parseRoomMetadata } from "@/components/meeting/room-metadata";
import { getDictionary } from "@/lib/i18n";
import type { MeetingChatMessage, MeetingTranscriptSegment } from "@/components/meeting/types";
import type { FormActionResult, SupportedLanguage } from "@/lib/session-contracts";
import type { PrivateRecipientOption } from "@/components/SessionChatPanel";
import type { FacilitatorAnalyticsView } from "@/lib/facilitator-analytics-view";

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
  viewerIsFacilitator,
  viewerUserId,
  canMessageFacilitatorPrivately,
  privateRecipientOptions,
  currentLanguage,
  onChangeLanguage,
  languageOptions,
  captionsHeader,
  captionComposer,
  analyticsView,
}: {
  sessionId: string;
  role: Role;
  uiLang: SupportedLanguage;
  targetLanguage: string;
  transcript: MeetingTranscriptSegment[];
  messages: MeetingChatMessage[];
  sendChatAction: (prevState: FormActionResult, formData: FormData) => Promise<FormActionResult>;
  allowQuestions?: boolean;
  dashboardHref: string;
  title: string;
  inviteLink?: string | null;
  viewerIsFacilitator?: boolean;
  viewerUserId?: string;
  canMessageFacilitatorPrivately?: boolean;
  privateRecipientOptions?: PrivateRecipientOption[];
  currentLanguage: SupportedLanguage;
  onChangeLanguage: (lang: SupportedLanguage) => Promise<void>;
  languageOptions?: readonly { value: SupportedLanguage; nativeLabel: string }[];
  captionsHeader?: ReactNode;
  captionComposer?: ReactNode;
  analyticsView?: FacilitatorAnalyticsView;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { workspaceMode } = useMeetingShell();
  const { metadata } = useRoomInfo();
  const { allowLearnerPresenting } = parseRoomMetadata(metadata);
  const canPresent = role === "facilitator" || allowLearnerPresenting;

  // `caption-agent.ts` (the server-side LiveKit Agents worker that subscribes to the
  // facilitator's mic for captions — see docs/TRANSLATION_ARCHITECTURE.md Part 2) joins
  // this same room as its own participant (identity like "agent-AJ_...") so it can
  // subscribe to audio. With `withPlaceholder: true` below, `useTracks` creates a camera
  // placeholder tile for EVERY participant with no camera publication — including that
  // agent, which never publishes one, showing up as a third, blank tile labeled with its
  // raw job ID next to "Facilitator"/"Learner". Real participants are always issued a
  // `"facilitator:<id>"`/`"learner:<id>"` identity (room.ts's `issueCredential`) —
  // filtering to that prefix excludes the agent (and any other future non-participant
  // service identity) without needing to know its exact naming scheme.
  const tracks = useTracks([
    { source: Track.Source.Camera, withPlaceholder: true },
    { source: Track.Source.Microphone, withPlaceholder: true },
    { source: Track.Source.ScreenShare, withPlaceholder: false },
  ]).filter(
    (track) => track.participant.identity.startsWith("facilitator:") || track.participant.identity.startsWith("learner:"),
  );
  const screenShareTrack = tracks.find((track) => track.source === Track.Source.ScreenShare);
  const cameraTracks = tracks.filter((track) => track.source === Track.Source.Camera);
  const micTracks = tracks.filter((track) => track.source === Track.Source.Microphone);
  const focusMode = Boolean(screenShareTrack) || workspaceMode === "whiteboard";
  // What a floating Picture-in-Picture window (see AutoPictureInPicture) should mirror while the
  // user is tabbed away: the shared screen if there is one, otherwise the local camera — a plain
  // "you're still on this call" indicator rather than trying to track the active speaker.
  const primaryTrack = screenShareTrack ?? cameraTracks.find((track) => track.participant.isLocal);
  const dict = getDictionary(uiLang);
  const captionsEmptyLabel = role === "facilitator" ? dict.facilitator.transcriptEmpty : dict.learner.captionsWillAppear;
  // Captions/translation are this product's whole reason to exist for a learner (see
  // problem_statement.md) — defaulting to the Chat tab (empty until someone types
  // something) reads as "nothing is happening" to a first-time learner who hasn't
  // discovered the other tab yet, right when live captions are actually the thing to
  // look at. Facilitators still default to Chat (matching SessionSidePanel's own
  // default), since they're the one composing captions, not just reading them.
  const sidebarDefaultTab = role === "learner" ? "captions" : "chat";
  // Only the facilitator's language change affects the live speech-recognition stream
  // (updateFacilitatorLanguage doesn't — and safely can't, without risking dropped audio
  // mid-utterance — reopen it, so it stays configured for whatever language it was
  // opened with) — a learner switching their own preferred/display language has no such
  // caveat, so this stays facilitator-only, matching the dashboard's own warning.
  const languageChangeWarning = role === "facilitator" ? dict.facilitator.languageChangeLiveWarning : undefined;

  return (
    <div ref={containerRef} className="flex h-full min-h-0 flex-col" tabIndex={-1}>
      <AutoPictureInPicture primaryTrack={primaryTrack} />
      <RaisedHandAnnouncer uiLang={uiLang} />
      <MeetingHeader
        title={title}
        inviteLink={inviteLink}
        uiLang={uiLang}
        currentLanguage={currentLanguage}
        onChangeLanguage={onChangeLanguage}
        languageOptions={languageOptions}
        languageChangeWarning={languageChangeWarning}
      />
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
        <MeetingSidebar
          uiLang={uiLang}
          targetLanguage={targetLanguage}
          messages={messages}
          sendChatAction={sendChatAction}
          allowQuestions={allowQuestions}
          viewerIsFacilitator={viewerIsFacilitator}
          viewerUserId={viewerUserId}
          canMessageFacilitatorPrivately={canMessageFacilitatorPrivately}
          privateRecipientOptions={privateRecipientOptions}
          transcript={transcript}
          captionsEmptyLabel={captionsEmptyLabel}
          captionsHeader={captionsHeader}
          captionComposer={captionComposer}
          defaultTab={sidebarDefaultTab}
          analyticsView={analyticsView}
        />
      </div>
      {/* `shrink-0` — defense in depth alongside globals.css's `.lk-button-group` height
          override (see that rule's own comment for the actual root cause of a mobile
          control-bar overlap it fixes): keeps this row's box from ever being shrunk
          below its wrapped content's real height by its `flex-1` video-stage sibling
          above, the same way that sibling is the one meant to absorb any space
          pressure in this flex column. */}
      <div className="flex shrink-0 justify-center border-t border-border-subtle p-2">
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
  sendChatAction: (prevState: FormActionResult, formData: FormData) => Promise<FormActionResult>;
  allowQuestions?: boolean;
  dashboardHref: string;
  title: string;
  inviteLink?: string | null;
  viewerIsFacilitator?: boolean;
  viewerUserId?: string;
  canMessageFacilitatorPrivately?: boolean;
  privateRecipientOptions?: PrivateRecipientOption[];
  currentLanguage: SupportedLanguage;
  onChangeLanguage: (lang: SupportedLanguage) => Promise<void>;
  languageOptions?: readonly { value: SupportedLanguage; nativeLabel: string }[];
  captionsHeader?: ReactNode;
  captionComposer?: ReactNode;
  analyticsView?: FacilitatorAnalyticsView;
}) {
  return (
    <MeetingShellProvider>
      <MeetingRoomInner {...props} />
    </MeetingShellProvider>
  );
}
