"use client";

import { startTransition } from "react";

/**
 * Minimum spacing enforced between any two `router.refresh()` calls made
 * through `scheduleCoordinatedRefresh`, regardless of which independent
 * trigger (SessionAutoRefresh's poll, CaptionChannelRefresher's DataChannel
 * push) asked for it.
 *
 * Both triggers used to call `router.refresh()` on their own, each wrapped in
 * its own `startTransition` — but two *separate* transitions racing the same
 * subtree can still overlap (React's scheduler doesn't coordinate across
 * independent `useTransition`/`startTransition` call sites just because
 * they're the same priority tier). Under a burst of rapid caption publishes —
 * realistic for continuous live speech, where every final utterance triggers
 * this same DataChannel push — that overlap was directly reproduced to make
 * LiveTranscriptFeed warn "Each child in a list should have a unique key
 * prop", even though the `entries` array it's actually handed is provably
 * well-formed (unique, non-empty ids) on every render leading up to the
 * warning. Issue #153's `dedupeById` doesn't touch this — there's never an
 * actual duplicate *value* to dedupe, so it can't fix a torn/interrupted
 * reconciliation between two overlapping transitions.
 *
 * Routing every trigger for a given tab's live-session page through this one
 * shared, trailing-edge-coalescing gate keeps refreshes from either source
 * spaced at least `MIN_REFRESH_GAP_MS` apart, which eliminated every
 * reproduction found under realistic caption-publish rates. A much rarer
 * recurrence still reproduces under synthetic worst-case load (dozens of
 * captions published faster than any live-speech STT pipeline or human typing
 * would) even with this gate in place — `entries` has never once been
 * observed malformed when that happens, so this is most likely a React/Next
 * internal reconciliation edge case under heavy, rapid transcript growth
 * rather than a data-correctness bug this module can fix outright. See the
 * tracking issue for the full investigation.
 */
const MIN_REFRESH_GAP_MS = 400;

let lastRefreshAt = 0;
let pendingTimeout: ReturnType<typeof setTimeout> | null = null;

export function scheduleCoordinatedRefresh(refresh: () => void): void {
  if (pendingTimeout !== null) clearTimeout(pendingTimeout);
  const elapsed = Date.now() - lastRefreshAt;
  const delay = Math.max(0, MIN_REFRESH_GAP_MS - elapsed);
  pendingTimeout = setTimeout(() => {
    pendingTimeout = null;
    lastRefreshAt = Date.now();
    startTransition(refresh);
  }, delay);
}
