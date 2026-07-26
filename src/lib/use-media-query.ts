"use client";

import { useSyncExternalStore } from "react";

/**
 * `@livekit/components-react` does not export a `useMediaQuery` hook (checked the installed
 * v2.9.23 type defs) — this is a small hand-rolled equivalent, following the same
 * `useSyncExternalStore` + browser API pattern already used by `AccessibilityPanel`.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (callback) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", callback);
      return () => mql.removeEventListener("change", callback);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
