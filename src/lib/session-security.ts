import { createHash, randomBytes } from "node:crypto";

export function createOpaqueToken() {
  return randomBytes(32).toString("base64url");
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
