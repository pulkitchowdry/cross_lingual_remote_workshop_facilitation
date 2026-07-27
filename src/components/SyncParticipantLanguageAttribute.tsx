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
    void localParticipant.setAttributes({ preferredLanguage: lang });
  }, [localParticipant, lang]);
  return null;
}
