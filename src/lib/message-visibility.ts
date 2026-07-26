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

export function validateFacilitatorPrivateRecipient({
  participant,
  sessionId,
}: {
  participant: ChatRecipientParticipant | null;
  sessionId: string;
}) {
  if (!participant || participant.sessionId !== sessionId || participant.role !== "LEARNER") {
    return { error: "Choose a learner in this session for a private reply.", recipientId: null };
  }
  return { error: null, recipientId: participant.userId };
}
