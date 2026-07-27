import { describe, expect, it } from "vitest";
import { ParticipantRole } from "@/generated/prisma/client";
import {
  isMessageVisibleToUser,
  publicSessionMessageWhere,
  validateFacilitatorPrivateRecipient,
  visibleSessionMessageWhere,
} from "@/lib/message-visibility";

describe("message visibility", () => {
  it("builds a server-side filter for public messages and messages involving the viewer", () => {
    expect(visibleSessionMessageWhere("session-1", "viewer-user")).toEqual({
      sessionId: "session-1",
      OR: [{ recipientId: null }, { senderId: "viewer-user" }, { recipientId: "viewer-user" }],
    });
  });

  it("builds a server-side filter for public-only group summaries and analytics", () => {
    expect(publicSessionMessageWhere("session-1")).toEqual({
      sessionId: "session-1",
      recipientId: null,
    });
  });

  it("does not expose private originals or translations to unrelated learners", () => {
    const privateFromLearnerToFacilitator = { senderId: "learner-a", recipientId: "facilitator" };
    const privateFromFacilitatorToLearner = { senderId: "facilitator", recipientId: "learner-a" };

    expect(isMessageVisibleToUser(privateFromLearnerToFacilitator, "learner-b")).toBe(false);
    expect(isMessageVisibleToUser(privateFromFacilitatorToLearner, "learner-b")).toBe(false);
  });

  it("allows sender, recipient, and any participant viewing public messages", () => {
    expect(isMessageVisibleToUser({ senderId: "learner-a", recipientId: "facilitator" }, "learner-a")).toBe(true);
    expect(isMessageVisibleToUser({ senderId: "learner-a", recipientId: "facilitator" }, "facilitator")).toBe(true);
    expect(isMessageVisibleToUser({ senderId: "learner-a", recipientId: null }, "learner-b")).toBe(true);
  });

  it("accepts only learners in the same session as facilitator private recipients", () => {
    expect(
      validateFacilitatorPrivateRecipient({
        sessionId: "session-1",
        participant: {
          id: "participant-a",
          userId: "learner-a",
          role: ParticipantRole.LEARNER,
          sessionId: "session-1",
        },
      }),
    ).toEqual({ error: null, recipientId: "learner-a" });

    expect(
      validateFacilitatorPrivateRecipient({
        sessionId: "session-1",
        participant: {
          id: "participant-b",
          userId: "learner-b",
          role: ParticipantRole.LEARNER,
          sessionId: "session-2",
        },
      }).error,
    ).toBe("Choose a learner in this session for a private reply.");

    expect(
      validateFacilitatorPrivateRecipient({
        sessionId: "session-1",
        participant: {
          id: "participant-f",
          userId: "facilitator",
          role: ParticipantRole.FACILITATOR,
          sessionId: "session-1",
        },
      }).error,
    ).toBe("Choose a learner in this session for a private reply.");
  });
});
