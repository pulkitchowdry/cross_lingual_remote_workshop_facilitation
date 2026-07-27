"use client";

import { useEffect } from "react";
import { useLocalParticipant } from "@livekit/components-react";
import type { SupportedLanguage } from "@/lib/session-contracts";

/**
 * Keeps the local participant's LiveKit `preferredLanguage` attribute live —
 * every other connected client reads this (via `useSpeakerLanguages`, see
 * `use-speaker-languages.ts`) to decide whether to duck this participant's
 * raw mic audio and auto-play a dub instead (`DuckedRoomAudio`/
 * `TranslatedAudioPlayer`).
 *
 * `issueCredential` (room.ts) bakes `preferredLanguage` into the room token's
 * attributes at connect time, but the token itself is fetched once and never
 * refreshed (see `LiveSessionRoom.tsx`) — so a mid-session language change
 * (`updateFacilitatorLanguage`/`updateLearnerLanguage`) would otherwise leave
 * every other client seeing the stale value for the rest of the call. This
 * pushes the fresh value the moment it changes, the same way `raisedHand`
 * already updates live (see `room.ts`'s `canUpdateOwnMetadata` grant) — no
 * DataChannel signal or poll needed, LiveKit replicates attribute changes to
 * every client automatically.
 */
export function SyncParticipantLanguageAttribute({ lang }: { lang: SupportedLanguage }) {
  const { localParticipant } = useLocalParticipant();
  useEffect(() => {
    localParticipant.setAttributes({ preferredLanguage: lang }).catch((error) => {
      // Same rationale as the raisedHand attribute update this mirrors (see
      // MeetingToolbar's toggleRaiseHand) — a disconnected/unstable room connection
      // surfaces here as a timeout, not a bug in this effect. Logged so a failed
      // language-sync doesn't fail completely silently instead of becoming an
      // unhandled rejection; no user-facing error or retry here since the raisedHand
      // precedent this mirrors doesn't have either.
      console.error("[meeting] failed to sync preferred-language attribute:", error);
    });
  }, [localParticipant, lang]);
  return null;
}
