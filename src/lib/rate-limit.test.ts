import { afterEach, describe, expect, it, vi } from "vitest";
import { isRateLimited } from "./rate-limit";

describe("isRateLimited", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows calls up to the max within a window, then blocks the next one", () => {
    const key = `test-${Math.random()}`;
    expect(isRateLimited(key, 3, 10_000)).toBe(false);
    expect(isRateLimited(key, 3, 10_000)).toBe(false);
    expect(isRateLimited(key, 3, 10_000)).toBe(false);
    expect(isRateLimited(key, 3, 10_000)).toBe(true);
  });

  it("tracks distinct keys independently", () => {
    const keyA = `a-${Math.random()}`;
    const keyB = `b-${Math.random()}`;
    expect(isRateLimited(keyA, 1, 10_000)).toBe(false);
    expect(isRateLimited(keyA, 1, 10_000)).toBe(true);
    expect(isRateLimited(keyB, 1, 10_000)).toBe(false);
  });

  it("resets once the window elapses", () => {
    vi.useFakeTimers();
    const key = `window-${Math.random()}`;
    expect(isRateLimited(key, 1, 1_000)).toBe(false);
    expect(isRateLimited(key, 1, 1_000)).toBe(true);

    vi.advanceTimersByTime(1_001);

    expect(isRateLimited(key, 1, 1_000)).toBe(false);
  });
});
