import { afterEach, describe, expect, it, vi } from "vitest";
import { TranslationMode, SessionStatus, type Session } from "@/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  glossaryTermFindMany: vi.fn(async () => []),
  centralGlossaryFindMany: vi.fn(async () => []),
  sessionFindUnique: vi.fn(async () => ({ status: SessionStatus.LIVE })),
  transcriptSegmentCreate: vi.fn(async () => ({ id: "segment-1" })),
  translateText: vi.fn(async () => null),
  notifyCaptionsChanged: vi.fn(),
  recordUnknownGlossaryTerms: vi.fn(async () => undefined),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    glossaryTerm: { findMany: mocks.glossaryTermFindMany },
    centralGlossaryEntry: { findMany: mocks.centralGlossaryFindMany },
    session: { findUnique: mocks.sessionFindUnique },
    transcriptSegment: { create: mocks.transcriptSegmentCreate },
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/providers/translation", () => ({ translateText: mocks.translateText }));
vi.mock("@/lib/providers/room", () => ({
  roomProvider: { notifyCaptionsChanged: mocks.notifyCaptionsChanged },
}));
vi.mock("@/lib/providers/insight", () => ({ insightProvider: { isConfigured: false } }));
vi.mock("@/lib/glossary-suggestions", () => ({
  recordUnknownGlossaryTerms: mocks.recordUnknownGlossaryTerms,
}));

// This is the regression path for the still-live "You" hallucination spam (PR #182
// only patched local-inference's one-shot Whisper tier, which this app's live
// captions don't use unless LOCAL_INFERENCE_URL is configured — the actual live
// path is Deepgram via captions-socket.ts/caption-agent.ts, both of which funnel
// into publishTranslatedCaption below with zero prior filtering).
describe("publishTranslatedCaption", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  const session = {
    id: "session-1",
    translationMode: TranslationMode.AUTO,
  } as unknown as Session;

  const baseInput = {
    speakerId: "Alice (Facilitator)",
    language: "en" as const,
    startedAt: new Date(),
    endedAt: new Date(),
  };

  it("drops a streamed STT segment whose full text is a known hallucinated filler phrase, before any translation/DB work", async () => {
    const { publishTranslatedCaption } = await import("@/lib/captions");

    await publishTranslatedCaption(session, { ...baseInput, originalText: "You" });

    expect(mocks.sessionFindUnique).not.toHaveBeenCalled();
    expect(mocks.transcriptSegmentCreate).not.toHaveBeenCalled();
    expect(mocks.translateText).not.toHaveBeenCalled();
  });

  it("does not drop a facilitator/learner-typed caption with the same text — only STT hallucinates", async () => {
    const { publishTranslatedCaption } = await import("@/lib/captions");

    await publishTranslatedCaption(session, { ...baseInput, originalText: "You", isTyped: true });

    expect(mocks.transcriptSegmentCreate).toHaveBeenCalledTimes(1);
  });

  it("keeps a real STT segment that merely contains a filler word mid-sentence", async () => {
    const { publishTranslatedCaption } = await import("@/lib/captions");

    await publishTranslatedCaption(session, { ...baseInput, originalText: "I think you understand" });

    expect(mocks.transcriptSegmentCreate).toHaveBeenCalledTimes(1);
  });
});
