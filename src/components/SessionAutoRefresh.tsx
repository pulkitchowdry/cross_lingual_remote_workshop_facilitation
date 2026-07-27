"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { scheduleCoordinatedRefresh } from "@/lib/coordinated-refresh";

export function SessionAutoRefresh({ intervalMs = 2_000, durationMs }: { intervalMs?: number; durationMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const interval = window.setInterval(() => {
      // Routed through the shared coordinator (see its doc comment) rather than
      // calling `router.refresh()` directly, so this poll can't overlap with
      // CaptionChannelRefresher's independent DataChannel-triggered refresh —
      // confirmed by direct reproduction to otherwise be able to make
      // LiveTranscriptFeed warn about a missing list key under a burst of rapid
      // caption publishes. `scheduleCoordinatedRefresh` already coalesces
      // near-simultaneous calls from either trigger into one; an in-flight
      // chat/caption Server Action (translation alone can take up to ~16s worst
      // case) can still mean a few queued ticks each schedule their own refresh
      // at the tail once it resolves, but Next's own router action queue already
      // serializes the underlying fetches, so that's wasted requests, not broken
      // behavior.
      scheduleCoordinatedRefresh(() => router.refresh());
    }, intervalMs);
    // `durationMs` bounds how long this component keeps polling after mount —
    // used to give a short grace period of extra refreshes right after a
    // session ends, so a background insight (see captions.ts's `waitUntil`)
    // that's still finishing when the page stops being LIVE isn't stranded
    // with nothing left to pick it up. Omit for indefinite polling (the LIVE case).
    const timeout = durationMs !== undefined ? window.setTimeout(() => window.clearInterval(interval), durationMs) : null;
    return () => {
      window.clearInterval(interval);
      if (timeout !== null) window.clearTimeout(timeout);
    };
  }, [intervalMs, durationMs, router]);

  return null;
}
