import { revalidatePath } from "next/cache";

/**
 * `revalidatePath` requires an active Next.js request/Server Action async
 * context. Several callers of this app's caption/insight pipeline don't have
 * one — the caption-streaming WebSocket upgrade handler and the LiveKit
 * Agents job process (see `server.ts`) both run outside `handle(req, res)`
 * entirely, so a bare `revalidatePath` throws "Invariant: static generation
 * store missing" there, every single time. This cache invalidation is a
 * nice-to-have (`CaptionChannelRefresher`'s DataChannel signal and
 * `SessionAutoRefresh`'s polling are the load-bearing update paths already),
 * not something a background/non-request caller can afford to crash on.
 */
export function safeRevalidatePath(path: string) {
  try {
    revalidatePath(path);
  } catch {
    // See doc comment above: not every caller has a request context to revalidate against.
  }
}
