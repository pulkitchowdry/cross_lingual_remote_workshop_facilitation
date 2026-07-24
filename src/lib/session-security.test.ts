import { describe, expect, it } from "vitest";
import {
  createOpaqueToken,
  facilitatorCookieName,
  hashToken,
  learnerCookieName,
  learnerInviteCookieName,
  secureCompare,
} from "./session-security";

describe("createOpaqueToken", () => {
  it("generates a URL-safe, unguessable token", () => {
    const token = createOpaqueToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThan(32);
  });

  it("never repeats across calls", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => createOpaqueToken()));
    expect(tokens.size).toBe(50);
  });
});

describe("hashToken", () => {
  it("is deterministic for the same input", () => {
    const token = createOpaqueToken();
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it("never stores the raw token in the hash", () => {
    const token = "a-known-plaintext-token";
    expect(hashToken(token)).not.toContain(token);
  });

  it("produces different hashes for different tokens", () => {
    expect(hashToken("token-a")).not.toBe(hashToken("token-b"));
  });
});

describe("cookie name helpers", () => {
  it("scope each cookie name to its session so cookies cannot cross sessions", () => {
    expect(facilitatorCookieName("session-1")).not.toBe(facilitatorCookieName("session-2"));
    expect(learnerCookieName("session-1")).not.toBe(learnerInviteCookieName("session-1"));
  });
});

describe("secureCompare", () => {
  it("returns true for identical strings", () => {
    expect(secureCompare("shared-secret", "shared-secret")).toBe(true);
  });

  it("returns false for different strings of the same length", () => {
    expect(secureCompare("shared-secreT", "shared-secret")).toBe(false);
  });

  it("returns false for strings of different lengths, without throwing", () => {
    expect(secureCompare("short", "much-longer-string")).toBe(false);
  });

  it("returns false against an empty string", () => {
    expect(secureCompare("", "shared-secret")).toBe(false);
  });
});
