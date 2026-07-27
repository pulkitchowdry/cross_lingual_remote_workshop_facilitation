import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `scheduleCoordinatedRefresh` keeps trailing-edge-coalescing state at module
 * scope (see its own doc comment for why — one gate shared by every trigger for
 * a page, not per-caller state) — `vi.resetModules()` + a fresh dynamic import
 * per test gives each test its own instance instead of leaking timers/state
 * across tests.
 */
async function freshModule() {
  vi.resetModules();
  return import("./coordinated-refresh");
}

describe("scheduleCoordinatedRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires immediately on the first call", async () => {
    const { scheduleCoordinatedRefresh } = await freshModule();
    const refresh = vi.fn();
    scheduleCoordinatedRefresh(refresh);
    vi.runOnlyPendingTimers();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("coalesces a burst of near-simultaneous calls into a single refresh, using the last callback given", async () => {
    const { scheduleCoordinatedRefresh } = await freshModule();
    // A fresh module's `lastRefreshAt` starts at 0, so the very first call in any
    // test always fires immediately (elapsed since epoch 0 vastly exceeds the
    // gap) — settle that one first so the burst below is testing the realistic
    // case: several calls arriving shortly after a previous refresh, not the
    // always-immediate first-ever call.
    scheduleCoordinatedRefresh(vi.fn());
    vi.runOnlyPendingTimers();

    const first = vi.fn();
    const second = vi.fn();
    const third = vi.fn();
    scheduleCoordinatedRefresh(first);
    vi.advanceTimersByTime(5);
    scheduleCoordinatedRefresh(second);
    vi.advanceTimersByTime(5);
    scheduleCoordinatedRefresh(third);
    vi.runOnlyPendingTimers();

    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    expect(third).toHaveBeenCalledTimes(1);
  });

  it("fires a second, separate refresh once the gap has fully elapsed since the last one", async () => {
    const { scheduleCoordinatedRefresh } = await freshModule();
    const first = vi.fn();
    const second = vi.fn();

    scheduleCoordinatedRefresh(first);
    vi.runOnlyPendingTimers();
    expect(first).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(500); // past MIN_REFRESH_GAP_MS (400ms)
    scheduleCoordinatedRefresh(second);
    vi.runOnlyPendingTimers();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("delays a call arriving shortly after the previous refresh instead of firing back-to-back", async () => {
    const { scheduleCoordinatedRefresh } = await freshModule();
    const first = vi.fn();
    const second = vi.fn();

    scheduleCoordinatedRefresh(first);
    vi.runOnlyPendingTimers();
    expect(first).toHaveBeenCalledTimes(1);

    // Well inside the gap — SessionAutoRefresh's poll and CaptionChannelRefresher's
    // DataChannel push landing this close together is exactly the scenario this
    // exists to coalesce instead of letting both fire as separate transitions.
    vi.advanceTimersByTime(100);
    scheduleCoordinatedRefresh(second);
    expect(second).not.toHaveBeenCalled();

    vi.runOnlyPendingTimers();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
