"use client";

import { useParticipants } from "@livekit/components-react";
import type { TrackReferenceOrPlaceholder } from "@livekit/components-core";
import { Track } from "livekit-client";
import { ParticipantChip } from "@/components/meeting/ParticipantChip";
import type { SupportedLanguage } from "@/lib/session-contracts";

/**
 * Only rendered by `MeetingRoom` while screen-share or the whiteboard is the
 * primary workspace (i.e. "focus mode") — sits in normal document flow
 * *above* the shared content (not overlaid on top of it, which would
 * obstruct the view), spanning the full width like Zoom/Meet's presenter-mode
 * thumbnail strip. In plain video mode, participants are the grid itself;
 * this never shows.
 */
export function ParticipantStrip({
  uiLang,
  cameraTracks,
  micTracks,
}: {
  uiLang: SupportedLanguage;
  cameraTracks: TrackReferenceOrPlaceholder[];
  micTracks: TrackReferenceOrPlaceholder[];
}) {
  const participants = useParticipants();

  return (
    <div
      className="flex w-full shrink-0 items-center justify-center gap-2 overflow-x-auto border-b border-border-subtle bg-surface-raised p-2"
      style={{ scrollSnapType: "x proximity" }}
      role="list"
    >
      {participants.map((participant) => (
        <div
          key={participant.identity}
          className="aspect-square h-20 shrink-0 sm:h-28"
          style={{ scrollSnapAlign: "start" }}
        >
          <ParticipantChip
            participant={participant}
            camTrack={cameraTracks.find((t) => t.source === Track.Source.Camera && t.participant.identity === participant.identity)}
            micTrack={micTracks.find((t) => t.source === Track.Source.Microphone && t.participant.identity === participant.identity)}
            uiLang={uiLang}
            variant="tile"
          />
        </div>
      ))}
    </div>
  );
}
