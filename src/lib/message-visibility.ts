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
