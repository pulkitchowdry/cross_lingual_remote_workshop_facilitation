import { cookies } from "next/headers";
import { ParticipantRole } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { facilitatorCookieName, hashToken, learnerCookieName } from "@/lib/session-security";

export async function hasFacilitatorAccess(sessionId: string) {
  const token = (await cookies()).get(facilitatorCookieName(sessionId))?.value;
  if (!token) return false;

  const link = await prisma.joinLink.findUnique({ where: { tokenHash: hashToken(token) } });
  return Boolean(
    link &&
      link.sessionId === sessionId &&
      link.role === ParticipantRole.FACILITATOR &&
      !link.revokedAt &&
      (!link.expiresAt || link.expiresAt >= new Date()),
  );
}

export async function learnerParticipantId(sessionId: string) {
  const participantId = (await cookies()).get(learnerCookieName(sessionId))?.value;
  if (!participantId) return null;

  const participant = await prisma.sessionParticipant.findFirst({
    where: { id: participantId, sessionId, role: ParticipantRole.LEARNER },
    select: { id: true },
  });
  return participant?.id ?? null;
}
