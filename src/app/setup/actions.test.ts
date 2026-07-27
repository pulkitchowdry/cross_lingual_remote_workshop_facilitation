import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookiesSet: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  transaction: vi.fn(),
  userCreate: vi.fn(),
  sessionCreate: vi.fn(),
  translateText: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ set: mocks.cookiesSet })),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/db", () => ({
  prisma: { $transaction: mocks.transaction },
}));
vi.mock("@/lib/providers/translation", () => ({ translateText: mocks.translateText }));

function form(entries: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    formData.set(key, value);
  }
  return formData;
}

function baseFormEntries(overrides: Record<string, string> = {}) {
  return {
    facilitatorName: "Ada Facilitator",
    title: "Intro to Distributed Systems",
    goal: "Understand consensus algorithms",
    sourceLanguage: "en",
    retentionDays: "7",
    ...overrides,
  };
}

describe("createSession session-title/goal translation fan-out", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({
        user: { create: mocks.userCreate },
        session: { create: mocks.sessionCreate },
      }),
    );
    mocks.userCreate.mockResolvedValue({ id: "facilitator-user" });
    mocks.sessionCreate.mockResolvedValue({ id: "session-1" });
  });

  it("translates title and goal into every non-source supported language and persists them nested under the session", async () => {
    const { createSession } = await import("@/app/setup/actions");
    mocks.translateText.mockImplementation(async (text: string, source: string, target: string) => {
      if (source === target) return null;
      return { text: `[${target}] ${text}`, provider: "claude", qualitySignal: "provider-confirmed", confidence: 90 };
    });

    await expect(createSession(form(baseFormEntries()))).rejects.toThrow("redirect:/sessions/session-1/facilitator");

    // en->en is never called (translateText itself would short-circuit, but confirms
    // every *other* supported language was attempted for both fields).
    expect(mocks.translateText).toHaveBeenCalledWith("Intro to Distributed Systems", "en", "zh", expect.anything());
    expect(mocks.translateText).toHaveBeenCalledWith("Intro to Distributed Systems", "en", "es", expect.anything());
    expect(mocks.translateText).toHaveBeenCalledWith("Understand consensus algorithms", "en", "zh", expect.anything());
    expect(mocks.translateText).toHaveBeenCalledWith("Understand consensus algorithms", "en", "es", expect.anything());

    const createArgs = mocks.sessionCreate.mock.calls[0][0];
    expect(createArgs.data.translations.create).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetLanguage: "zh",
          title: "[zh] Intro to Distributed Systems",
          goal: "[zh] Understand consensus algorithms",
          provider: "claude",
        }),
        expect.objectContaining({
          targetLanguage: "es",
          title: "[es] Intro to Distributed Systems",
          goal: "[es] Understand consensus algorithms",
          provider: "claude",
        }),
      ]),
    );
    // No row at all for the source language itself — translateText(en, en) returns
    // null for both fields, matching MessageTranslation's convention.
    expect(createArgs.data.translations.create).toHaveLength(2);
  });

  it("omits a language's row entirely when translation is unavailable for both fields, instead of persisting the untranslated original", async () => {
    const { createSession } = await import("@/app/setup/actions");
    mocks.translateText.mockResolvedValue(null);

    await expect(createSession(form(baseFormEntries()))).rejects.toThrow("redirect:/sessions/session-1/facilitator");

    const createArgs = mocks.sessionCreate.mock.calls[0][0];
    expect(createArgs.data.translations.create).toEqual([]);
  });

  it("keeps a language's row when only one of title/goal translates successfully", async () => {
    const { createSession } = await import("@/app/setup/actions");
    mocks.translateText.mockImplementation(async (text: string, source: string, target: string) => {
      if (source === target) return null;
      if (text === "Intro to Distributed Systems") {
        return { text: `[${target}] ${text}`, provider: "nllb", qualitySignal: "provider-confirmed", confidence: 80 };
      }
      return null;
    });

    await expect(createSession(form(baseFormEntries()))).rejects.toThrow("redirect:/sessions/session-1/facilitator");

    const createArgs = mocks.sessionCreate.mock.calls[0][0];
    expect(createArgs.data.translations.create).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetLanguage: "zh", title: "[zh] Intro to Distributed Systems", goal: null }),
        expect.objectContaining({ targetLanguage: "es", title: "[es] Intro to Distributed Systems", goal: null }),
      ]),
    );
  });

  it("disallows cloud fallback when strict privacy is enabled", async () => {
    const { createSession } = await import("@/app/setup/actions");
    mocks.translateText.mockResolvedValue(null);

    await expect(
      createSession(form(baseFormEntries({ strictPrivacy: "on" }))),
    ).rejects.toThrow("redirect:/sessions/session-1/facilitator");

    expect(mocks.translateText).toHaveBeenCalledWith(
      expect.any(String),
      "en",
      "zh",
      expect.objectContaining({ allowCloudFallback: false }),
    );
  });
});
