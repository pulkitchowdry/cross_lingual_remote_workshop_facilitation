import { describe, expect, it } from "vitest";
import { isContrastMode, isFontSize, nextFontSize, toggleContrastMode } from "./accessibility-preferences";

describe("isFontSize", () => {
  it("accepts every supported font size", () => {
    expect(isFontSize("normal")).toBe(true);
    expect(isFontSize("large")).toBe(true);
    expect(isFontSize("x-large")).toBe(true);
  });

  it("rejects values that were never written by this app (corrupted or stale localStorage)", () => {
    expect(isFontSize("huge")).toBe(false);
    expect(isFontSize("")).toBe(false);
    expect(isFontSize(null)).toBe(false);
    expect(isFontSize(undefined)).toBe(false);
    expect(isFontSize(12)).toBe(false);
  });
});

describe("isContrastMode", () => {
  it("accepts both contrast modes", () => {
    expect(isContrastMode("standard")).toBe(true);
    expect(isContrastMode("high")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isContrastMode("max")).toBe(false);
    expect(isContrastMode(null)).toBe(false);
    expect(isContrastMode(undefined)).toBe(false);
  });
});

describe("nextFontSize", () => {
  it("cycles normal -> large -> x-large -> normal", () => {
    expect(nextFontSize("normal")).toBe("large");
    expect(nextFontSize("large")).toBe("x-large");
    expect(nextFontSize("x-large")).toBe("normal");
  });
});

describe("toggleContrastMode", () => {
  it("flips between standard and high", () => {
    expect(toggleContrastMode("standard")).toBe("high");
    expect(toggleContrastMode("high")).toBe("standard");
  });
});
