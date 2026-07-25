import { describe, expect, it } from "vitest";
import { clearCaptionAgentCapturing, isCaptionAgentCapturing, markCaptionAgentCapturing } from "@/lib/caption-source-state";

describe("caption-source-state", () => {
  it("reports false for a session that was never marked", () => {
    expect(isCaptionAgentCapturing("never-marked")).toBe(false);
  });

  it("reports true after marking and false after clearing", () => {
    markCaptionAgentCapturing("session-1");
    expect(isCaptionAgentCapturing("session-1")).toBe(true);

    clearCaptionAgentCapturing("session-1");
    expect(isCaptionAgentCapturing("session-1")).toBe(false);
  });

  it("tracks sessions independently", () => {
    markCaptionAgentCapturing("session-a");
    expect(isCaptionAgentCapturing("session-a")).toBe(true);
    expect(isCaptionAgentCapturing("session-b")).toBe(false);
    clearCaptionAgentCapturing("session-a");
  });
});
