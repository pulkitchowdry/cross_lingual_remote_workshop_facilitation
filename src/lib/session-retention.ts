import { SessionStatus } from "@/generated/prisma/client";

const DAY_MS = 24 * 60 * 60 * 1000;

/** When a session's transcript/chat data must be purged, per its own retentionDays choice. */
export function retentionDeadline(endedAt: Date, retentionDays: number): Date {
  return new Date(endedAt.getTime() + retentionDays * DAY_MS);
}

export function isRetentionExpired(endedAt: Date, retentionDays: number, now: Date): boolean {
  return retentionDeadline(endedAt, retentionDays).getTime() <= now.getTime();
}

/**
 * Whether a session's own retention window has passed, given its actual
 * lifecycle: anchored to `endedAt` normally, falling back to `createdAt` for a
 * session that was started but never explicitly ended (facilitator browser
 * crash, lost connectivity) — see the cleanup cron (retention/cleanup/route.ts),
 * which uses this same anchor so an abandoned session doesn't retain its
 * transcript/chat/participant data forever. Shared with the facilitator/learner
 * pages so an already-expired session can't still be viewed for up to an hour
 * (the cron's schedule) — or indefinitely, if the cron never runs — just
 * because the physical delete hasn't happened yet.
 */
export function isSessionRetentionExpired(
  session: { status: SessionStatus; createdAt: Date; startedAt: Date | null; endedAt: Date | null; retentionDays: number },
  now: Date = new Date(),
): boolean {
  // A DRAFT session that was never started (startedAt still null) has no lifecycle
  // to anchor retention to yet, despite what the docstring above already promises
  // ("started but never explicitly ended") — falling back to `createdAt` here used
  // to give every not-yet-started session a hard deletion deadline anyway, so a
  // workshop prepared ahead of time (and any learners already waiting in it) could
  // get permanently deleted before it ever ran.
  if (session.startedAt === null) return false;
  // A currently-LIVE session is never "expired", full stop — its participants are
  // actively using it right now, and a workshop simply running longer than its own
  // retentionDays choice (a transcript-retention preference, not a session-length
  // limit) must not have every page serving it 404 out from under the facilitator
  // and every learner mid-session, with the facilitator's own "End session" button
  // now unreachable through the UI that 404s it. The cleanup cron already enforces
  // this same exemption at its own DB query (`status: { not: LIVE } }`), but every
  // other call site (facilitator/learner pages, the join flow, the per-segment audio
  // route) was calling this function unguarded and repeating that mistake
  // independently — baking it in here means a future call site can't repeat it.
  if (session.status === SessionStatus.LIVE) return false;
  return isRetentionExpired(session.endedAt ?? session.startedAt, session.retentionDays, now);
}
