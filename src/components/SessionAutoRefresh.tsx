"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

export function SessionAutoRefresh({ intervalMs = 2_000, durationMs }: { intervalMs?: number; durationMs?: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Read via a ref inside the interval callback (below), not `isPending` directly, so
  // toggling it doesn't need to be in the effect's own dependency array — that would
  // tear down and recreate the interval (and its 2s countdown) on every refresh
  // start/settle instead of just skipping a tick when needed.
  const isPendingRef = useRef(isPending);
  useEffect(() => {
    isPendingRef.current = isPending;
  }, [isPending]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      // Next's router action queue serializes a new REFRESH action behind whatever's
      // already pending rather than coalescing or dropping stale ones — an in-flight
      // chat/caption Server Action (translation alone can take up to ~16s worst case)
      // would otherwise let 6-8 ticks' worth of refreshes pile up and all fire
      // back-to-back the instant it resolves, each one a full transcript/chat re-fetch
      // and re-render. Skipping a tick while our own last-dispatched refresh is still
      // pending (which stays true for as long as it's queued, not just while it's
      // actually running) caps that burst to at most one queued refresh instead.
      if (isPendingRef.current) return;
      startTransition(() => router.refresh());
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
  }, [intervalMs, durationMs, router, startTransition]);

  return null;
}
