"use client";

import type { TrackReferenceOrPlaceholder } from "@livekit/components-core";
import { ParticipantChip } from "@/components/meeting/ParticipantChip";
import type { SupportedLanguage } from "@/lib/session-contracts";

/**
 * The main video stage in plain (non-focus) mode — one tile per participant,
 * center stage, using the same `ParticipantChip` design (real camera thumbnail
 * or name initials, never a stock placeholder) as the floating strip. Renders
 * from `cameraTracks` directly (one entry per participant, real publication or
 * placeholder) rather than a separate `useParticipants()` call, so a
 * participant who has never published a camera still gets a tile.
 */
export function ParticipantGrid({
  uiLang,
  cameraTracks,
  micTracks,
}: {
  uiLang: SupportedLanguage;
  cameraTracks: TrackReferenceOrPlaceholder[];
  micTracks: TrackReferenceOrPlaceholder[];
}) {
  return (
    <div
      className="grid h-full w-full gap-2 p-2"
      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gridAutoRows: "minmax(140px, 1fr)" }}
      role="list"
    >
      {cameraTracks.map((track) => (
        <ParticipantChip
          key={track.participant.identity}
          participant={track.participant}
          camTrack={track}
          micTrack={micTracks.find((t) => t.participant.identity === track.participant.identity)}
          uiLang={uiLang}
          variant="tile"
        />
      ))}
    </div>
  );
}
