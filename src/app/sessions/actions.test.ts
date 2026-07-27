import { beforeEach, describe, expect, it, vi } from "vitest";
import { ParticipantRole, SessionStatus } from "@/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  sessionFindUnique: vi.fn(),
  participantFindFirst: vi.fn(),
  messageCreate: vi.fn(),
  centralGlossaryEntryFindMany: vi.fn(),
  hasFacilitatorAccess: vi.fn(),
  learnerParticipantId: vi.fn(),
  translateText: vi.fn(),
  isRateLimited: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/db", () => ({
  prisma: {
    session: { findUnique: mocks.sessionFindUnique },
    sessionParticipant: { findFirst: mocks.participantFindFirst },
    message: { create: mocks.messageCreate },
    centralGlossaryEntry: { findMany: mocks.centralGlossaryEntryFindMany },
  },
}));
vi.mock("@/lib/session-access", () => ({
  hasFacilitatorAccess: mocks.hasFacilitatorAccess,
  learnerParticipantId: mocks.learnerParticipantId,
}));
vi.mock("@/lib/providers/translation", () => ({ translateText: mocks.translateText }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: mocks.isRateLimited }));

function form(entries: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    formData.set(key, value);
  }
  return formData;
}

const liveSession = {
  id: "session-1",
  status: SessionStatus.LIVE,
  facilitatorId: "facilitator-user",
  sourceLanguage: "en",
  translationMode: "LOCAL_ONLY",
};

describe("sendChatMessage private message authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessionFindUnique.mockReset();
    mocks.participantFindFirst.mockReset();
    mocks.messageCreate.mockResolvedValue({});
    mocks.translateText.mockResolvedValue(null);
    mocks.centralGlossaryEntryFindMany.mockResolvedValue([]);
    mocks.isRateLimited.mockReturnValue(false);
    mocks.hasFacilitatorAccess.mockResolvedValue(true);
    mocks.learnerParticipantId.mockResolvedValue("learner-participant-a");
    mocks.sessionFindUnique.mockResolvedValueOnce(liveSession).mockResolvedValueOnce({ status: SessionStatus.LIVE });
  });

  it("lets a learner send privately only to the session facilitator", async () => {
    const { sendChatMessage } = await import("@/app/sessions/actions");
    mocks.participantFindFirst.mockResolvedValueOnce({
      id: "learner-participant-a",
      sessionId: "session-1",
      role: ParticipantRole.LEARNER,
      userId: "learner-user-a",
      preferredLanguage: "es",
    });

    const result = await sendChatMessage(
      "session-1",
      "learner",
      { error: null },
      form({ message: "Necesito ayuda", visibility: "PRIVATE" }),
    );

    expect(result).toEqual({ error: null });
    expect(mocks.messageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          senderId: "learner-user-a",
          recipientId: "facilitator-user",
          originalText: "Necesito ayuda",
          language: "es",
        }),
      }),
    );
  });

  it("rejects a learner attempt to privately target another learner", async () => {
    const { sendChatMessage } = await import("@/app/sessions/actions");
    mocks.participantFindFirst.mockResolvedValueOnce({
      id: "learner-participant-a",
      sessionId: "session-1",
      role: ParticipantRole.LEARNER,
      userId: "learner-user-a",
      preferredLanguage: "en",
    });

    const result = await sendChatMessage(
      "session-1",
      "learner",
      { error: null },
      form({
        message: "secret",
        visibility: "PRIVATE",
        recipientParticipantId: "learner-participant-b",
      }),
    );

    expect(result.error).toBe("Learners can only message the facilitator privately.");
    expect(mocks.messageCreate).not.toHaveBeenCalled();
    expect(mocks.translateText).not.toHaveBeenCalled();
  });

  it("lets a facilitator privately reply to a learner in the same session", async () => {
    const { sendChatMessage } = await import("@/app/sessions/actions");
    mocks.participantFindFirst
      .mockResolvedValueOnce({ id: "facilitator-participant" })
      .mockResolvedValueOnce({
        id: "learner-participant-a",
        sessionId: "session-1",
        role: ParticipantRole.LEARNER,
        userId: "learner-user-a",
      });

    const result = await sendChatMessage(
      "session-1",
      "facilitator",
      { error: null },
      form({
        message: "Try checking the request payload first.",
        visibility: "PRIVATE",
        recipientParticipantId: "learner-participant-a",
      }),
    );

    expect(result).toEqual({ error: null });
    expect(mocks.messageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          senderId: "facilitator-user",
          recipientId: "learner-user-a",
          originalText: "Try checking the request payload first.",
          language: "en",
        }),
      }),
    );
  });

  it("rejects facilitator private replies to participants outside the session", async () => {
    const { sendChatMessage } = await import("@/app/sessions/actions");
    mocks.participantFindFirst
      .mockResolvedValueOnce({ id: "facilitator-participant" })
      .mockResolvedValueOnce(null);

    const result = await sendChatMessage(
      "session-1",
      "facilitator",
      { error: null },
      form({
        message: "private",
        visibility: "PRIVATE",
        recipientParticipantId: "other-session-participant",
      }),
    );

    expect(result.error).toBe("Choose a learner in this session for a private reply.");
    expect(mocks.messageCreate).not.toHaveBeenCalled();
    expect(mocks.translateText).not.toHaveBeenCalled();
  });

  it("preserves public QUESTION chat without a private recipient", async () => {
    const { sendChatMessage } = await import("@/app/sessions/actions");
    mocks.participantFindFirst.mockResolvedValueOnce({
      id: "learner-participant-a",
      sessionId: "session-1",
      role: ParticipantRole.LEARNER,
      userId: "learner-user-a",
      preferredLanguage: "en",
    });

    const result = await sendChatMessage(
      "session-1",
      "learner",
      { error: null },
      form({ message: "Can you explain?", kind: "QUESTION" }),
    );

    expect(result).toEqual({ error: null });
    expect(mocks.messageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "QUESTION",
          recipientId: null,
          originalText: "Can you explain?",
        }),
      }),
    );
  });

  it("rejects unauthenticated facilitator private sends", async () => {
    const { sendChatMessage } = await import("@/app/sessions/actions");
    mocks.hasFacilitatorAccess.mockResolvedValueOnce(false);

    await expect(
      sendChatMessage(
        "session-1",
        "facilitator",
        { error: null },
        form({ message: "private", visibility: "PRIVATE", recipientParticipantId: "learner-participant-a" }),
      ),
    ).rejects.toThrow("redirect:/setup");
    expect(mocks.messageCreate).not.toHaveBeenCalled();
  });
});
