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
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

/** Returns true if `key` has already made `max` or more calls within the last `windowMs`, and records this call either way. */
export function isRateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    if (buckets.size >= MAX_TRACKED_KEYS && !buckets.has(key)) {
      const oldestKey = buckets.keys().next().value;
      if (oldestKey !== undefined) buckets.delete(oldestKey);
    }
    buckets.set(key, { count: 1, windowStart: now });
    return false;
  }
  bucket.count += 1;
  return bucket.count > max;
}
