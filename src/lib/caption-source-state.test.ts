import { afterEach, describe, expect, it, vi } from "vitest";

const updateMock = vi.fn();
const participantUpdateMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { session: { update: updateMock }, sessionParticipant: { update: participantUpdateMock } },
}));

describe("caption-source-state", () => {
  afterEach(() => {
    updateMock.mockReset();
    participantUpdateMock.mockReset();
  });

  it("markCaptionAgentCapturing sets captionAgentActive true for the given session", async () => {
    updateMock.mockResolvedValue({});
    const { markCaptionAgentCapturing } = await import("@/lib/caption-source-state");

    await markCaptionAgentCapturing("session-1");

    expect(updateMock).toHaveBeenCalledWith({ where: { id: "session-1" }, data: { captionAgentActive: true } });
  });

  it("clearCaptionAgentCapturing sets captionAgentActive false for the given session", async () => {
    updateMock.mockResolvedValue({});
    const { clearCaptionAgentCapturing } = await import("@/lib/caption-source-state");

    await clearCaptionAgentCapturing("session-1");

    expect(updateMock).toHaveBeenCalledWith({ where: { id: "session-1" }, data: { captionAgentActive: false } });
  });

  it("never throws when the database write fails — the audio stream this guards must keep running regardless", async () => {
    updateMock.mockRejectedValue(new Error("connection reset"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { markCaptionAgentCapturing, clearCaptionAgentCapturing } = await import("@/lib/caption-source-state");

    await expect(markCaptionAgentCapturing("session-1")).resolves.toBeUndefined();
    await expect(clearCaptionAgentCapturing("session-1")).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });

  it("markLearnerCaptionAgentCapturing sets agentCapturing true for the given participant", async () => {
    participantUpdateMock.mockResolvedValue({});
    const { markLearnerCaptionAgentCapturing } = await import("@/lib/caption-source-state");

    await markLearnerCaptionAgentCapturing("participant-1");

    expect(participantUpdateMock).toHaveBeenCalledWith({ where: { id: "participant-1" }, data: { agentCapturing: true } });
  });

  it("clearLearnerCaptionAgentCapturing sets agentCapturing false for the given participant", async () => {
    participantUpdateMock.mockResolvedValue({});
    const { clearLearnerCaptionAgentCapturing } = await import("@/lib/caption-source-state");

    await clearLearnerCaptionAgentCapturing("participant-1");

    expect(participantUpdateMock).toHaveBeenCalledWith({ where: { id: "participant-1" }, data: { agentCapturing: false } });
  });

  it("never throws when the learner's database write fails, for the same reason as the facilitator path", async () => {
    participantUpdateMock.mockRejectedValue(new Error("connection reset"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { markLearnerCaptionAgentCapturing, clearLearnerCaptionAgentCapturing } = await import("@/lib/caption-source-state");

    await expect(markLearnerCaptionAgentCapturing("participant-1")).resolves.toBeUndefined();
    await expect(clearLearnerCaptionAgentCapturing("participant-1")).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });
});
