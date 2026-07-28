import { describe, expect, it } from "vitest";
import { initials } from "@/components/meeting/ParticipantChip";

describe("initials", () => {
  it("takes the first letter of the first two words", () => {
    expect(initials("Jeffrey Goh")).toBe("JG");
  });

  it("ignores a trailing parenthetical suffix instead of using its opening paren", () => {
    // Reproduced live in UAT round 15: a learner named "李伟 (Learner)" rendered a "李(" tile
    // avatar because the old split-on-whitespace logic took the first character of "(Learner)"
    // as the second initial.
    expect(initials("李伟 (Learner)")).toBe("李");
    expect(initials("John (Facilitator)")).toBe("J");
  });

  it("falls back to a single question mark for an all-punctuation name", () => {
    expect(initials("(unknown)")).toBe("?");
  });

  it("falls back to a single question mark for an empty/whitespace-only name", () => {
    expect(initials("   ")).toBe("?");
  });

  it("handles a single-word name", () => {
    expect(initials("Priya")).toBe("P");
  });
});
