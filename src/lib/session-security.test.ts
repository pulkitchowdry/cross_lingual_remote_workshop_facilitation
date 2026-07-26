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

  it("returns true for identical strings even when compared against differently-sized buffers of unequal original length", () => {
    // Regression test: secureCompare must hash both inputs to fixed-length digests before
    // calling timingSafeEqual, rather than short-circuiting on raw byte-length mismatch —
    // that early return skipped the constant-time comparison entirely and could leak the
    // secret's length via response timing. Exercise it with multi-byte (non-ASCII)
    // characters too, since those differ in string .length vs. byte length.
    const short = "a";
    const long = "a-much-longer-string-with-more-bytes-日本語";
    expect(secureCompare(short, short)).toBe(true);
    expect(secureCompare(long, long)).toBe(true);
    expect(secureCompare(short, long)).toBe(false);
    expect(secureCompare(long, short)).toBe(false);
  });
});
