/**
 * Shared LiveKit room-metadata parsing — the facilitator-only "allow learners
 * to present" toggle (see room.ts's setPresenterAccess) is read by both
 * MeetingRoom (to gate the toolbar) and Whiteboard (to validate incoming
 * DataChannel senders actually had drawing rights when they sent).
 */
export function parseRoomMetadata(metadata: string | undefined): { allowLearnerPresenting: boolean } {
  if (!metadata) return { allowLearnerPresenting: false };
  try {
    const parsed = JSON.parse(metadata) as { allowLearnerPresenting?: unknown };
    return { allowLearnerPresenting: parsed.allowLearnerPresenting === true };
  } catch {
    return { allowLearnerPresenting: false };
  }
}

/** Derives a participant's role from their LiveKit identity, minted as `${role}:${identity}` (see room.ts). */
export function parseSenderRole(identity: string | undefined): "facilitator" | "learner" | null {
  if (!identity) return null;
  const role = identity.split(":")[0];
  return role === "facilitator" || role === "learner" ? role : null;
}
