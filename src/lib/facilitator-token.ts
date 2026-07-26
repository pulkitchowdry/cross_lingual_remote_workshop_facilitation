import { ParticipantRole } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { hashToken } from "@/lib/session-security";

/**
 * The facilitator-cookie check, without depending on `next/headers`' `cookies()`.
 * Deliberately kept in its own module: merely *importing* `next/headers`
 * (even if unused) throws outside a real Next request context — this module
 * is imported directly by `server.ts`'s raw HTTP `upgrade` handler, which
 * runs before any Next request context exists.
 */
export async function verifyFacilitatorToken(sessionId: string, token: string) {
  const link = await prisma.joinLink.findUnique({ where: { tokenHash: hashToken(token) } });
  return Boolean(
    link &&
      link.sessionId === sessionId &&
      link.role === ParticipantRole.FACILITATOR &&
      !link.revokedAt &&
      (!link.expiresAt || link.expiresAt >= new Date()),
  );
}
