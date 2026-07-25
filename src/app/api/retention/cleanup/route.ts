import { NextRequest } from "next/server";
import { SessionStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { isSessionRetentionExpired } from "@/lib/session-retention";
import { secureCompare } from "@/lib/session-security";

/**
 * Enforces the "Automatic deletion after session" / "No permanent storage
 * unless enabled" privacy goals (docs/FEATURE_LIST.md Module 6) — retentionDays
 * was previously captured at session setup but never acted on (issue #62).
 * Meant to be triggered by an external scheduler (Railway Cron Job, GitHub
 * Actions schedule, cron-job.org, etc.) sending `Authorization: Bearer
 * ${CRON_SECRET}`; also callable manually with the same header for local
 * testing.
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
  // Every non-LIVE session, not just ENDED ones: a facilitator who starts a session
  // and then never clicks "End" (browser crash, closed laptop, lost connectivity)
  // would otherwise keep its full transcript/chat/participant data forever, since
  // nothing else ever sets `status: ENDED` / `endedAt`. isSessionRetentionExpired
  // falls back to `startedAt` for a session that never ended, giving every abandoned
  // LIVE-then-never-ended session a hard retention cap regardless of how it stopped
  // being live — but returns false outright for a DRAFT session that was never even
  // started (`startedAt` still null), since that has no lifecycle to anchor a
  // deletion deadline to yet. A currently LIVE session is excluded outright too — its
  // participants are actively using it right now, and `startedAt` alone says nothing
  // about that; a workshop running longer than its own `retentionDays` (a
  // facilitator's transcript-retention choice, not a session-length limit) must not
  // have its data deleted out from under it mid-session. The tradeoff is that a
  // session stuck LIVE forever (never explicitly ended) keeps its data indefinitely
  // too — an acceptable cost next to deleting an active session's data.
  const sessions = await prisma.session.findMany({
    where: { status: { not: SessionStatus.LIVE } },
    select: { id: true, status: true, createdAt: true, startedAt: true, endedAt: true, retentionDays: true },
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

    // Atomic: without this, a crash/restart between the two deletes (Railway
    // redeploy, OOM, a scheduler with a short HTTP timeout) leaves sessions
    // gone but their Users un-swept — and permanently un-purgeable, since the
    // next run can only find orphan-User candidates via *currently expired*
    // sessions, which no longer exist for this batch.
    await prisma.$transaction(async (tx) => {
      await tx.session.deleteMany({ where: { id: { in: expiredIds } } });

      if (candidateUserIds.length > 0) {
        await tx.user.deleteMany({
          where: { id: { in: candidateUserIds }, sessions: { none: {} }, participations: { none: {} } },
        });
      }
      // Prisma's default 5s interactive-transaction timeout is tuned for a single
      // small write; a backlog of many expired sessions (each cascading across
      // TranscriptSegment/Message/Insight/GlossaryTerm/SessionParticipant/JoinLink)
      // can take longer, and a timed-out transaction rolls back entirely — so a
      // large-enough backlog would make every cron run fail the exact same way
      // forever, permanently stalling retention purging. Matches the timeout
      // insights.ts's own transaction already uses for the same reason.
    }, { timeout: 20_000 });
  }

  return Response.json({ deletedSessionIds: expiredIds });
}

// Some schedulers default to GET rather than POST; support both so any
// scheduler works without extra configuration.
export const GET = POST;
