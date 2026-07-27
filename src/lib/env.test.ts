import { describe, expect, it } from "vitest";
import { assertRequiredEnv, providerAvailability, resolveAppUrl, validateEnv } from "./env";

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

  it("lists LIVEKIT_AGENT_URL as optional, configured only when set", () => {
    expect(validateEnv({ DATABASE_URL: "postgresql://localhost/db" }).configuredOptional).not.toContain(
      "LIVEKIT_AGENT_URL",
    );
    expect(
      validateEnv({ DATABASE_URL: "postgresql://localhost/db", LIVEKIT_AGENT_URL: "http://livekit:7880" })
        .configuredOptional,
    ).toContain("LIVEKIT_AGENT_URL");
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

  it("reports text-to-speech availability from a single key", () => {
    expect(providerAvailability({}).textToSpeech).toBe(false);
    expect(providerAvailability({ TTS_API_KEY: "key" }).textToSpeech).toBe(true);
  });

  it("requires both local-inference variables before reporting it configured", () => {
    expect(providerAvailability({ LOCAL_INFERENCE_URL: "https://x" }).localInference).toBe(false);
    expect(
      providerAvailability({ LOCAL_INFERENCE_URL: "https://x", LOCAL_INFERENCE_SECRET: "s" }).localInference,
    ).toBe(true);
  });
});

describe("resolveAppUrl", () => {
  it("prefers NEXT_PUBLIC_APP_URL when it's set, ignoring the request entirely", () => {
    const headers = new Headers({ host: "example.com", "x-forwarded-proto": "https" });
    expect(resolveAppUrl(headers, { NEXT_PUBLIC_APP_URL: "https://prod.example" })).toBe("https://prod.example");
  });

  it("derives the origin from the request's Host header when unset — not a hardcoded port", () => {
    // The exact bug this guards against: a local dev server running on a
    // non-default port (e.g. because 3000 is already taken by another
    // project) must not hand out invite links pointing at localhost:3000.
    const headers = new Headers({ host: "localhost:3010" });
    expect(resolveAppUrl(headers, {})).toBe("http://localhost:3010");
  });

  it("uses x-forwarded-proto when present, defaulting to http", () => {
    const headers = new Headers({ host: "app.example.com", "x-forwarded-proto": "https" });
    expect(resolveAppUrl(headers, {})).toBe("https://app.example.com");
  });

  it("falls back to localhost:3000 only when the request has no Host header at all", () => {
    expect(resolveAppUrl(new Headers(), {})).toBe("http://localhost:3000");
  });
});
