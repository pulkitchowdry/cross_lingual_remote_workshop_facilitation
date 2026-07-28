import type { ParticipantRole } from "@/generated/prisma/client";

export const PRIVATE_MESSAGE_VISIBILITY = "PRIVATE";

export interface MessageVisibilityTarget {
  senderId: string;
  recipientId: string | null;
}

export interface ChatRecipientParticipant {
  id: string;
  userId: string;
  role: ParticipantRole;
  sessionId: string;
}

export function visibleSessionMessageWhere(sessionId: string, viewerUserId: string) {
  return {
    sessionId,
    OR: [{ recipientId: null }, { senderId: viewerUserId }, { recipientId: viewerUserId }],
  };
}

export function publicSessionMessageWhere(sessionId: string) {
  return { sessionId, recipientId: null };
}

/**
 * Every message the facilitator can legitimately see on their own dashboard: public
 * messages plus ones privately addressed to them. Distinct from `publicSessionMessageWhere`
 * (which the facilitator-only confusion/participation/analytics aggregates used to use) —
 * a learner who also checks "message facilitator privately" alongside "flag as question"
 * produces a QUESTION message with a non-null recipientId, which `publicSessionMessageWhere`
 * silently excludes even though the facilitator already sees its content in their own chat
 * panel (`visibleSessionMessageWhere` includes it there). There is no privacy reason to
 * exclude it from the facilitator's own aggregate signals about their own dashboard's data.
 * Keep using `publicSessionMessageWhere` for genuinely public-facing aggregates (e.g. the
 * whole-room AI session summary in src/lib/insights.ts), where a learner's private message
 * must never leak in.
 */
export function facilitatorVisibleSessionMessageWhere(sessionId: string, facilitatorId: string) {
  return { sessionId, OR: [{ recipientId: null }, { recipientId: facilitatorId }] };
}

export function isMessageVisibleToUser(message: MessageVisibilityTarget, viewerUserId: string) {
  return message.recipientId === null || message.senderId === viewerUserId || message.recipientId === viewerUserId;
}

/**
 * `SessionChatPanel` (a Client Component) only decides whether to *display*
 * `dict.anonymousLearner` vs `message.sender.displayName` — it never controls what data
 * actually reaches the browser. A Server Component -> Client Component prop crosses the
 * RSC boundary by serializing the whole object into the page's flight payload, so passing
 * `message.sender` (the full `User` row, including the real `displayName`) straight through
 * for an anonymous message ships the "hidden" identity to every co-learner's browser anyway
 * — visible via View Source, the Network tab, or React DevTools, completely defeating the
 * anonymity guarantee. Facilitators are meant to still see the real name (their own
 * `viewerIsFacilitator: true` branch is correct as-is and does NOT go through this
 * redaction); ordinary learners must never receive it in the first place.
 */
export function redactAnonymousSenders<T extends { isAnonymous?: boolean; sender: { displayName: string } }>(
  messages: T[],
): T[] {
  return messages.map((message) => (message.isAnonymous ? { ...message, sender: { displayName: "" } } : message));
}

export function isPrivateMessageRequest(role: "facilitator" | "learner", formData: FormData) {
  if (formData.get("visibility") === PRIVATE_MESSAGE_VISIBILITY) return true;
  if (role === "learner" && formData.get("privateToFacilitator") === "true") return true;
  const recipientParticipantId = formData.get("recipientParticipantId");
  return role === "facilitator" && typeof recipientParticipantId === "string" && recipientParticipantId.trim() !== "";
}

/**
 * No hardcoded error string here — this is a plain, unlocalized lib module,
 * and every caller already has its own localized `chatErrors` dictionary in
 * hand (see sessions/actions.ts) for the identical "no valid recipient"
 * condition (an empty `recipientParticipantId` never reaches the DB lookup
 * this validates). Returning `recipientId: null` lets the caller reuse that
 * same localized message instead of this function shipping its own
 * always-English one.
 */
export function validateFacilitatorPrivateRecipient({
  participant,
  sessionId,
}: {
  participant: ChatRecipientParticipant | null;
  sessionId: string;
}): { recipientId: string | null } {
  if (!participant || participant.sessionId !== sessionId || participant.role !== "LEARNER") {
    return { recipientId: null };
  }
  return { recipientId: participant.userId };
}
