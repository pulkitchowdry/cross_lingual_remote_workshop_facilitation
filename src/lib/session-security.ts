import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function createOpaqueToken() {
  return randomBytes(32).toString("base64url");
}

/** Constant-time string comparison for shared secrets (Bearer/header tokens), to avoid leaking match length via response timing. */
export function secureCompare(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
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
