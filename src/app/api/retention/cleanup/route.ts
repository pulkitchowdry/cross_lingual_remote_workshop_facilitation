import { NextRequest } from "next/server";
import { SessionStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { isRetentionExpired } from "@/lib/session-retention";
import { secureCompare } from "@/lib/session-security";

/**
 * Enforces the "Automatic deletion after session" / "No permanent storage
 * unless enabled" privacy goals (docs/FEATURE_LIST.md Module 6) — retentionDays
 * was previously captured at session setup but never acted on (issue #62).
 * Meant to be triggered by Vercel Cron (see vercel.json), which sends
 * `Authorization: Bearer ${CRON_SECRET}` automatically once CRON_SECRET is
 * set on the project; also callable manually with the same header for local
 * testing or non-Vercel schedulers.
 */
function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  const provided = request.headers.get("authorization");
  if (!expected || !provided) return false;
  return secureCompare(provided, `Bearer ${expected}`);
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const now = new Date();
  const ended = await prisma.session.findMany({
    where: { status: SessionStatus.ENDED, endedAt: { not: null } },
    select: { id: true, endedAt: true, retentionDays: true },
  });

  const expiredIds = ended
    .filter((session) => session.endedAt && isRetentionExpired(session.endedAt, session.retentionDays, now))
    .map((session) => session.id);

  if (expiredIds.length > 0) {
    // Every content table (TranscriptSegment, Message, Insight, GlossaryTerm,
    // SessionParticipant, JoinLink) cascades from Session in schema.prisma,
    // so deleting the session row is sufficient and leaves nothing orphaned.
    await prisma.session.deleteMany({ where: { id: { in: expiredIds } } });
  }

  return Response.json({ deletedSessionIds: expiredIds });
}

// Vercel Cron sends GET by default unless a method is configured; support
// both so the vercel.json schedule below works without extra configuration.
export const GET = POST;
