import { describe, expect, it } from "vitest";
import { shouldAutoplaySegment, shouldKeepQueuedEntry } from "@/components/TranslatedAudioPlayer";

describe("shouldAutoplaySegment", () => {
  it("always autoplays a typed caption, even with captions off and the opt-in unchecked", () => {
    // Regression: an earlier version gated this on `captionsVisible` too, so once that
    // flag defaulted to false, a facilitator's typed caption silently produced no audio
    // for any learner who hadn't opted into captions — breaking the composer's own promise
    // ("read aloud to every learner ... even if they haven't turned on translated audio").
    const typed = { isTyped: true, language: "en" };
    expect(shouldAutoplaySegment(typed, "zh", false, false)).toBe(true);
  });

  it("does not autoplay a same-language spoken segment unless captions are on and opted in", () => {
    const sameLanguage = { isTyped: false, language: "zh" };
    expect(shouldAutoplaySegment(sameLanguage, "zh", false, false)).toBe(false);
    expect(shouldAutoplaySegment(sameLanguage, "zh", true, false)).toBe(false);
    expect(shouldAutoplaySegment(sameLanguage, "zh", true, true)).toBe(true);
    expect(shouldAutoplaySegment(sameLanguage, "zh", false, true)).toBe(false);
  });

  it("only autoplays a cross-language spoken segment once captions are on", () => {
    const crossLanguage = { isTyped: false, language: "en" };
    expect(shouldAutoplaySegment(crossLanguage, "zh", false, false)).toBe(false);
    expect(shouldAutoplaySegment(crossLanguage, "zh", true, false)).toBe(true);
  });
});

describe("shouldKeepQueuedEntry", () => {
  it("keeps a typed entry queued/playing no matter what captions or the opt-in do", () => {
    const typed = { isTyped: true, alwaysPlay: true };
    expect(shouldKeepQueuedEntry(typed, false, false)).toBe(true);
    expect(shouldKeepQueuedEntry(typed, true, false)).toBe(true);
  });

  it("cuts off a cross-language entry the moment captions turn off", () => {
    // With captions off, DuckedRoomAudio no longer ducks the raw mic — a lingering dub
    // would talk over it.
    const crossLanguage = { isTyped: false, alwaysPlay: true };
    expect(shouldKeepQueuedEntry(crossLanguage, false, false)).toBe(false);
    expect(shouldKeepQueuedEntry(crossLanguage, true, false)).toBe(true);
  });

  it("cuts off a same-language opt-in entry once the opt-in is unchecked, captions staying on", () => {
    const sameLanguageOptIn = { isTyped: false, alwaysPlay: false };
    expect(shouldKeepQueuedEntry(sameLanguageOptIn, true, true)).toBe(true);
    expect(shouldKeepQueuedEntry(sameLanguageOptIn, true, false)).toBe(false);
  });
});
