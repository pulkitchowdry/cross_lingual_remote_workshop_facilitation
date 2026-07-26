/**
 * Minimal in-memory fixed-window rate limiter for server actions/routes that fan out
 * to paid per-call providers (Claude translation, ElevenLabs TTS) or mint new
 * DB-backed identities (learner join links) with no throttling of their own — see
 * issue's security-review finding on `sendChatMessage`/`joinSession`. In-process state
 * is a deliberate fit here: this app runs as a single persistent Node process (see
 * `server.ts`, not per-request serverless instances), so it doesn't need to survive a
 * restart or be shared across instances to be effective.
 *
 * A bucket per distinct key is kept forever once created; `MAX_TRACKED_KEYS` bounds
 * that growth for a long-running process by evicting the oldest-inserted key once the
 * cap is hit; a simple `Map` insertion-order eviction, not a true LRU, is deliberately
 * good enough here rather than pulling in a dependency for it.
 */
const MAX_TRACKED_KEYS = 10_000;

interface Bucket {
  /** Calls recorded in the current fixed sub-window. */
  count: number;
  /** Calls recorded in the immediately preceding fixed sub-window — still partially
   * weighted into the sliding estimate below until it fully ages out. */
  previousCount: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Returns true if `key` is estimated to have made `max` or more calls within the last
 * `windowMs` (a sliding lookback from `now`, not a fixed calendar-style window), and
 * records this call either way.
 *
 * Uses the standard sliding-window-counter approximation (two fixed sub-windows,
 * weighting the previous one by how much of it still overlaps the sliding lookback)
 * rather than a hard fixed-window reset — a hard reset lets a client send up to ~2x
 * `max` in a short burst timed around the window boundary (`max` right before the
 * reset, `max` again right after), since each side of the boundary independently
 * looks like a fresh, empty window. The approximation trades a small amount of
 * imprecision (it's an estimate, not an exact sliding-window log) for keeping this
 * a simple, allocation-light `{count, previousCount, windowStart}` bucket instead of
 * a growing list of per-call timestamps.
 */
export function isRateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  let bucket = buckets.get(key);

  if (!bucket) {
    if (buckets.size >= MAX_TRACKED_KEYS) {
      const oldestKey = buckets.keys().next().value;
      if (oldestKey !== undefined) buckets.delete(oldestKey);
    }
    bucket = { count: 0, previousCount: 0, windowStart: now };
    buckets.set(key, bucket);
  } else {
    const elapsed = now - bucket.windowStart;
    if (elapsed >= windowMs * 2) {
      // Both sub-windows are now entirely outside the sliding lookback — nothing left
      // to weight in, so this is equivalent to (and simpler than) rotating twice.
      bucket.count = 0;
      bucket.previousCount = 0;
      bucket.windowStart = now;
    } else if (elapsed >= windowMs) {
      // The current sub-window has fully elapsed: it becomes "previous" (still
      // partially weighted below) and a fresh sub-window starts where it left off,
      // not at `now` — so a call arriving just after the boundary doesn't get a
      // full fresh windowMs of headroom before the next rotation.
      bucket.previousCount = bucket.count;
      bucket.count = 0;
      bucket.windowStart += windowMs;
    }
  }

  bucket.count += 1;
  const elapsedInCurrent = now - bucket.windowStart;
  const overlapFraction = 1 - Math.min(1, elapsedInCurrent / windowMs);
  const estimatedCount = bucket.count + bucket.previousCount * overlapFraction;
  return estimatedCount > max;
}
