import { describe, expect, it } from "vitest";
import { isHallucinatedCaption } from "@/lib/caption-hallucination";

describe("isHallucinatedCaption", () => {
  it("flags the exact known Whisper/Deepgram filler phrases", () => {
    expect(isHallucinatedCaption("You")).toBe(true);
    expect(isHallucinatedCaption("you")).toBe(true);
    expect(isHallucinatedCaption("Thank you.")).toBe(true);
    expect(isHallucinatedCaption("  Thank you for watching!  ")).toBe(true);
    expect(isHallucinatedCaption("Bye bye.")).toBe(true);
  });

  it("leaves a real utterance that merely contains a filler word mid-sentence untouched", () => {
    expect(isHallucinatedCaption("I think you understand")).toBe(false);
    expect(isHallucinatedCaption("Thank you for the question, let's continue")).toBe(false);
    expect(isHallucinatedCaption("You should try the exercise now")).toBe(false);
  });

  it("does not flag unrelated or empty text", () => {
    expect(isHallucinatedCaption("Let's begin the workshop")).toBe(false);
    expect(isHallucinatedCaption("")).toBe(false);
  });
});
