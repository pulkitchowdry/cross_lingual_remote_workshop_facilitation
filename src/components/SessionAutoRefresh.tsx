"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function SessionAutoRefresh({ intervalMs = 2_000, durationMs }: { intervalMs?: number; durationMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const interval = window.setInterval(() => router.refresh(), intervalMs);
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
