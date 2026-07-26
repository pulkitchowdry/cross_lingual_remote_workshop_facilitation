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

  it("still limits shortly after a window boundary (sliding-window overlap), and fully resets once well past it", () => {
    vi.useFakeTimers();
    const key = `window-${Math.random()}`;
    expect(isRateLimited(key, 1, 1_000)).toBe(false);
    expect(isRateLimited(key, 1, 1_000)).toBe(true);

    // Just past the boundary: a fixed-window reset would treat this as a fresh, empty
    // window and allow it — the sliding window must still weigh the prior window's
    // 2 calls heavily this soon after the boundary, so this call is still blocked.
    vi.advanceTimersByTime(1_001);
    expect(isRateLimited(key, 1, 1_000)).toBe(true);

    // Well clear of the sliding lookback (2 full windows) — the prior window's calls
    // have fully aged out, so this is genuinely a fresh window.
    vi.advanceTimersByTime(2_000);
    expect(isRateLimited(key, 1, 1_000)).toBe(false);
  });

  it("does not allow roughly double the max in a burst timed around the window boundary (the fixed-window bug this fixes)", () => {
    vi.useFakeTimers();
    const key = `boundary-burst-${Math.random()}`;
    const max = 10;
    const windowMs = 10_000;

    let allowed = 0;
    for (let i = 0; i < max; i++) {
      if (!isRateLimited(key, max, windowMs)) allowed++;
    }
    expect(allowed).toBe(max);

    // Jump to just past the window boundary and send `max` more, back-to-back — the
    // classic fixed-window exploit (max right before the reset, max right after).
    vi.advanceTimersByTime(windowMs + 1);
    for (let i = 0; i < max; i++) {
      if (!isRateLimited(key, max, windowMs)) allowed++;
    }

    // A fixed-window reset would let this reach ~2*max; the sliding-window
    // approximation must keep the total meaningfully below that.
    expect(allowed).toBeLessThan(max * 1.5);
  });
});
