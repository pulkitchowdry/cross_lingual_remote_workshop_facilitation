import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function createOpaqueToken() {
  return randomBytes(32).toString("base64url");
}

/**
 * Constant-time string comparison for shared secrets (Bearer/header tokens), to avoid leaking match length via response timing.
 * Compares fixed-length SHA-256 digests of the inputs rather than the raw strings, so `timingSafeEqual` always
 * receives equal-length buffers regardless of how `a` and `b` differ in length — no length-based early return needed.
 */
export function secureCompare(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a).digest();
  const digestB = createHash("sha256").update(b).digest();
  return timingSafeEqual(digestA, digestB);
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function facilitatorCookieName(sessionId: string) {
  return `workshop-facilitator-${sessionId}`;
}

export function learnerInviteCookieName(sessionId: string) {
  return `workshop-learner-invite-${sessionId}`;
}

export function learnerCookieName(sessionId: string) {
  return `workshop-learner-${sessionId}`;
}
