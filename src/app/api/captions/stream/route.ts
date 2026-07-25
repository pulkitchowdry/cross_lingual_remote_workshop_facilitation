/**
 * Live-caption WebSocket endpoint — Part 2 of `docs/TRANSLATION_ARCHITECTURE.md`.
 * The actual upgrade is handled by `server.ts`, which intercepts the raw HTTP
 * `upgrade` event for this path before it ever reaches Next's router (Next
 * route handlers can't perform a WebSocket upgrade on their own). This
 * handler only runs for a plain, non-upgrade request to the same URL, which
 * shouldn't normally happen — the client only ever opens this as a
 * WebSocket — but is kept as a clean error instead of a 404.
 */
export async function GET() {
  return Response.json(
    {
      error: "This endpoint only accepts WebSocket connections. Use the typed caption box instead.",
    },
    { status: 400 },
  );
}
