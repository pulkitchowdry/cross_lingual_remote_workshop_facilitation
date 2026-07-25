import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { isSessionRetentionExpired } from "@/lib/session-retention";
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
  // Every session, not just ENDED ones: a facilitator who starts a session and
  // then never clicks "End" (browser crash, closed laptop, lost connectivity)
  // would otherwise keep its full transcript/chat/participant data forever,
  // since nothing else ever sets `status: ENDED` / `endedAt`. isSessionRetentionExpired
  // falls back to `createdAt` for a session that never ended, giving every session a
  // hard retention cap regardless of how it stopped being live.
  const sessions = await prisma.session.findMany({
    select: { id: true, createdAt: true, endedAt: true, retentionDays: true },
  });

  const expiredIds = sessions.filter((session) => isSessionRetentionExpired(session, now)).map((session) => session.id);

  if (expiredIds.length > 0) {
    // Every content table (TranscriptSegment, Message, Insight, GlossaryTerm,
    // SessionParticipant, JoinLink) cascades from Session in schema.prisma, so
    // deleting the session row reclaims those. But the facilitator's and every
    // learner's `User` row (their real display name + language) is only ever
    // pointed to *from* SessionParticipant/Session — deleting the session
    // leaves those User rows orphaned in the database forever unless they're
    // swept too. `{ none: {} }` only matches a User with zero remaining
    // sessions/participations, so a User who (in some future flow) is shared
    // across sessions is never deleted out from under a still-live one.
    const [facilitators, participants] = await Promise.all([
      prisma.session.findMany({ where: { id: { in: expiredIds } }, select: { facilitatorId: true } }),
      prisma.sessionParticipant.findMany({ where: { sessionId: { in: expiredIds } }, select: { userId: true } }),
    ]);
    const candidateUserIds = Array.from(
      new Set([...facilitators.map((f) => f.facilitatorId), ...participants.map((p) => p.userId)]),
    );

    await prisma.session.deleteMany({ where: { id: { in: expiredIds } } });

    if (candidateUserIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: candidateUserIds }, sessions: { none: {} }, participations: { none: {} } },
      });
    }
  }

  return Response.json({ deletedSessionIds: expiredIds });
}

// Vercel Cron sends GET by default unless a method is configured; support
// both so the vercel.json schedule below works without extra configuration.
export const GET = POST;
