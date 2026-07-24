const DAY_MS = 24 * 60 * 60 * 1000;

/** When a session's transcript/chat data must be purged, per its own retentionDays choice. */
export function retentionDeadline(endedAt: Date, retentionDays: number): Date {
  return new Date(endedAt.getTime() + retentionDays * DAY_MS);
}

export function isRetentionExpired(endedAt: Date, retentionDays: number, now: Date): boolean {
  return retentionDeadline(endedAt, retentionDays).getTime() <= now.getTime();
}
