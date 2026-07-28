import { afterEach, describe, expect, it, vi } from "vitest";
import { agentCaptureEnabled, agentCaptures, browserCaptureDisabled, captionCaptureMode } from "@/lib/caption-capture-mode";

const original = process.env.CAPTION_CAPTURE_MODE;

afterEach(() => {
  if (original === undefined) delete process.env.CAPTION_CAPTURE_MODE;
  else process.env.CAPTION_CAPTURE_MODE = original;
  vi.restoreAllMocks();
});

describe("captionCaptureMode", () => {
  it("defaults to the historical facilitator/learner split when unset, so nothing changes without opting in", () => {
    delete process.env.CAPTION_CAPTURE_MODE;
    expect(captionCaptureMode()).toBe("agent-facilitator");
    expect(agentCaptures("facilitator")).toBe(true);
    expect(agentCaptures("learner")).toBe(false);
  });

  it("falls back to the default on an unrecognized value rather than throwing", () => {
    // A typo in a Railway env var must not take a live session's captions down entirely.
    process.env.CAPTION_CAPTURE_MODE = "agent_all";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(captionCaptureMode()).toBe("agent-facilitator");
    expect(warn).toHaveBeenCalled();
  });

  it("reads the env var per call, so the forked agent subprocess and the web process agree", () => {
    process.env.CAPTION_CAPTURE_MODE = "agent-all";
    expect(captionCaptureMode()).toBe("agent-all");
    process.env.CAPTION_CAPTURE_MODE = "browser-only";
    expect(captionCaptureMode()).toBe("browser-only");
  });
});

describe("browserCaptureDisabled", () => {
  it("only agent-all forbids the browser stream, and then for both roles", () => {
    expect(browserCaptureDisabled("facilitator", "agent-all")).toBe(true);
    expect(browserCaptureDisabled("learner", "agent-all")).toBe(true);
  });

  it("KEEPS the facilitator's browser fallback under the default mode", () => {
    // The regression this guards: `browserCaptureDisabled` must not collapse into
    // `agentCaptures`. Under `agent-facilitator` the agent is the facilitator's primary
    // path and the browser stream is its fallback — the thing that keeps captions working
    // when the worker has no credentials, can't reach LiveKit (Railway IPv6 ENETUNREACH),
    // has its job refused by LiveKit's CPU-based load_fnc, or never gets dispatched. If
    // this returned true, `captionAgentActive` would stay false in all of those cases and
    // NEITHER pipeline would run, while the UI claimed captions were already active.
    expect(agentCaptures("facilitator", "agent-facilitator")).toBe(true);
    expect(browserCaptureDisabled("facilitator", "agent-facilitator")).toBe(false);
  });

  it("never forbids the browser stream when no worker is running", () => {
    expect(browserCaptureDisabled("facilitator", "browser-only")).toBe(false);
    expect(browserCaptureDisabled("learner", "browser-only")).toBe(false);
  });

  it("leaves the learner's browser stream alone under the default mode", () => {
    expect(agentCaptures("learner", "agent-facilitator")).toBe(false);
    expect(browserCaptureDisabled("learner", "agent-facilitator")).toBe(false);
  });

  it("never forbids a role the agent isn't capturing — that would leave it with no path at all", () => {
    for (const mode of ["agent-all", "agent-facilitator", "browser-only"] as const) {
      for (const role of ["facilitator", "learner"] as const) {
        if (browserCaptureDisabled(role, mode)) expect(agentCaptures(role, mode)).toBe(true);
      }
    }
  });
});

describe("agentCaptureEnabled", () => {
  it("stops the worker being started only under browser-only", () => {
    expect(agentCaptureEnabled("browser-only")).toBe(false);
    expect(agentCaptureEnabled("agent-all")).toBe(true);
    expect(agentCaptureEnabled("agent-facilitator")).toBe(true);
  });
});
