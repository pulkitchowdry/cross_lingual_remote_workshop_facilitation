"use client";

import { useRemoteParticipants } from "@livekit/components-react";
import { resolveLanguage } from "@/lib/i18n";
import type { SupportedLanguage } from "@/lib/session-contracts";

const FACILITATOR_IDENTITY_PREFIX = "facilitator:";
const LEARNER_IDENTITY_PREFIX = "learner:";

/**
 * A live `identity -> spoken language` map for every other participant in the
 * room, read straight off each `RemoteParticipant`'s `attributes.preferredLanguage`
 * (kept fresh by `SyncParticipantLanguageAttribute` on their end) — the single
 * source of truth `DuckedRoomAudio` and `TranslatedAudioPlayer` both use to
 * decide whether a given speaker's language differs from the local listener's
 * own. Re-renders automatically on join/leave/attribute-change since
 * `useRemoteParticipants` subscribes to those room events itself.
 *
 * `facilitatorSourceLanguage` is only a defensive fallback for the (narrow,
 * self-correcting) staleness window right after a facilitator's language
 * change and before their own attribute update lands — see
 * `SyncParticipantLanguageAttribute`'s doc comment.
 */
export function useSpeakerLanguages(facilitatorSourceLanguage: SupportedLanguage): Record<string, SupportedLanguage> {
  const participants = useRemoteParticipants();
  const languages: Record<string, SupportedLanguage> = {};
  for (const participant of participants) {
    const attributeLanguage = participant.attributes.preferredLanguage;
    if (attributeLanguage) {
      languages[participant.identity] = resolveLanguage(attributeLanguage);
    } else if (participant.identity.startsWith(FACILITATOR_IDENTITY_PREFIX)) {
      languages[participant.identity] = facilitatorSourceLanguage;
    }
    // A learner identity with no attribute yet (shouldn't happen — see doc
    // comment above) is simply omitted; callers should treat a missing entry
    // as "unknown, don't duck" rather than guessing.
  }
  return languages;
}

export { FACILITATOR_IDENTITY_PREFIX, LEARNER_IDENTITY_PREFIX };
