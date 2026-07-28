import { SessionStatus } from "@/generated/prisma/client";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Fallback retention cap for a DRAFT session that was never started — matches the
 * join link's own 30-day expiry (see src/app/join/[token]/actions.ts), since a
 * learner can join and consent to a DRAFT session (creating real User +
 * SessionParticipant rows with PII) well before the facilitator ever clicks Start. */
const DRAFT_RETENTION_DAYS = 30;

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
  // A DRAFT session that was never started (startedAt still null) has no normal
  // lifecycle to anchor retention to yet, despite what the docstring above already
  // promises ("started but never explicitly ended") — but it's still not exempt
  // outright: a learner can join and consent to a DRAFT session before it's started
  // (see src/app/join/[token]/actions.ts), creating real User + SessionParticipant
  // rows with PII. If the facilitator then abandons the session (never clicks
  // Start), that data would otherwise be retained forever with no cleanup path.
  // Anchoring to `createdAt` with the same 30-day cap as the join link's own expiry
  // bounds that instead, while still giving a workshop prepared well ahead of time
  // (and any learners already waiting in it) a generous window before it ever runs.
  if (session.startedAt === null) return isRetentionExpired(session.createdAt, DRAFT_RETENTION_DAYS, now);
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
