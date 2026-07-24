import { describe, expect, it } from "vitest";
import { assertRequiredEnv, providerAvailability, validateEnv } from "./env";

describe("validateEnv", () => {
  it("reports the required variable as missing when unset", () => {
    const result = validateEnv({});
    expect(result.ok).toBe(false);
    expect(result.missingRequired).toContain("DATABASE_URL");
  });

  it("passes once the required variable is set, ignoring unrelated env noise", () => {
    const result = validateEnv({ DATABASE_URL: "postgresql://localhost/db", PATH: "/usr/bin" });
    expect(result.ok).toBe(true);
    expect(result.missingRequired).toEqual([]);
  });

  it("treats a blank string as unset", () => {
    const result = validateEnv({ DATABASE_URL: "   " });
    expect(result.ok).toBe(false);
  });

  it("lists configured optional keys without requiring them", () => {
    const result = validateEnv({ DATABASE_URL: "postgresql://localhost/db", CLAUDE_API_KEY: "key" });
    expect(result.configuredOptional).toContain("CLAUDE_API_KEY");
  });
});

describe("assertRequiredEnv", () => {
  it("throws a single readable error naming every missing key", () => {
    expect(() => assertRequiredEnv({})).toThrow(/DATABASE_URL/);
  });

  it("does not throw once required keys are present", () => {
    expect(() => assertRequiredEnv({ DATABASE_URL: "postgresql://localhost/db" })).not.toThrow();
  });
});

describe("providerAvailability", () => {
  it("requires all three LiveKit variables before reporting it configured", () => {
    expect(providerAvailability({ LIVEKIT_URL: "wss://x" }).liveKit).toBe(false);
    expect(
      providerAvailability({
        LIVEKIT_URL: "wss://x",
        LIVEKIT_API_KEY: "k",
        LIVEKIT_API_SECRET: "s",
      }).liveKit,
    ).toBe(true);
  });

  it("reports claude translation availability from a single key", () => {
    expect(providerAvailability({}).claude).toBe(false);
    expect(providerAvailability({ CLAUDE_API_KEY: "key" }).claude).toBe(true);
  });
});
