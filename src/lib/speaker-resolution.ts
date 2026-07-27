import { prisma } from "@/lib/db";
import type { SupportedLanguage } from "@/lib/session-contracts";

export interface ResolvedLearnerSpeaker {
  language: SupportedLanguage;
  speakerId: string;
}

/**
 * Given a learner's `SessionParticipant.id`, resolves the language their speech/typed
 * captions should be attributed to (their own `preferredLanguage`, not the session's
 * `sourceLanguage`) and the `speakerId` to persist (their display name, matching the
 * convention `learn/actions.ts`'s typed-caption path already uses — `TranscriptSegment.
 * speakerId` has no FK relation, it's a free-text label). Shared by `caption-agent.ts`
 * (the LiveKit-agent capture path) and `captions-socket.ts` (the browser-mic WS
 * fallback) so both resolve a learner speaker identically. Returns `null` if the
 * participant no longer exists or belongs to a different session — callers should skip
 * publishing rather than guess.
 */
export async function resolveLearnerSpeaker(sessionId: string, participantId: string): Promise<ResolvedLearnerSpeaker | null> {
  const participant = await prisma.sessionParticipant.findUnique({
    where: { id: participantId },
    include: { user: true },
  });
  if (!participant || participant.sessionId !== sessionId) return null;
  return { language: participant.preferredLanguage as SupportedLanguage, speakerId: participant.user.displayName };
}
