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
  session: { createdAt: Date; startedAt: Date | null; endedAt: Date | null; retentionDays: number },
  now: Date = new Date(),
): boolean {
  // A DRAFT session that was never started (startedAt still null) has no lifecycle
  // to anchor retention to yet, despite what the docstring above already promises
  // ("started but never explicitly ended") — falling back to `createdAt` here used
  // to give every not-yet-started session a hard deletion deadline anyway, so a
  // workshop prepared ahead of time (and any learners already waiting in it) could
  // get permanently deleted before it ever ran.
  if (session.startedAt === null) return false;
  return isRetentionExpired(session.endedAt ?? session.startedAt, session.retentionDays, now);
}
