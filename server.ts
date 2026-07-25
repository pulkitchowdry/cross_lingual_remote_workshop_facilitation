import { createServer } from "node:http";
import { parse } from "node:url";
import { loadEnvConfig } from "@next/env";

// Must run before any module that reads `process.env` at import time (e.g.
// `@/lib/db`'s `assertRequiredEnv`) — Next only loads `.env.local`/`.env` for
// us once `app.prepare()` runs, which is too late for those top-level reads.
loadEnvConfig(process.cwd());

/**
 * Custom Node server for Railway (a persistent process). Next's route
 * handlers can't do a raw WebSocket upgrade on their own, so this
 * intercepts the HTTP server's `upgrade` event directly with `ws`, only for
 * `/api/captions/stream`; every other request (including plain, non-upgrade
 * GETs to that path) still goes through Next's normal request handler.
 */
async function main() {
  // `next` must finish initializing its runtime (require-hook, its internal
  // AsyncLocalStorage singletons) before anything that transitively imports
  // `next/headers` or `next/cache` loads — importing those too early throws
  // "AsyncLocalStorage accessed in runtime where it is not available", even
  // if the import is unused at that point. `app.prepare()` is what finishes
  // that initialization, so `@/lib/facilitator-token` and
  // `@/lib/captions-socket` (which pull in `next/cache` via `captions.ts`)
  // are imported only after it resolves, not up front with everything else.
  const { default: next } = await import("next");
  const { WebSocketServer } = await import("ws");
  const { prisma } = await import("@/lib/db");
  const { SessionStatus } = await import("@/generated/prisma/client");
  const { facilitatorCookieName } = await import("@/lib/session-security");
  const { speechToTextProvider } = await import("@/lib/providers/speech-to-text");

  const dev = process.env.NODE_ENV !== "production";
  const port = Number(process.env.PORT) || 3000;
  const app = next({ dev });
  const handle = app.getRequestHandler();

  function parseCookies(header: string | undefined): Record<string, string> {
    const cookies: Record<string, string> = {};
    if (!header) return cookies;
    for (const part of header.split(";")) {
      const index = part.indexOf("=");
      if (index === -1) continue;
      const name = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      if (name) cookies[name] = decodeURIComponent(value);
    }
    return cookies;
  }

  await app.prepare();

  const { verifyFacilitatorToken } = await import("@/lib/facilitator-token");
  const { attachCaptionSocket } = await import("@/lib/captions-socket");

  const server = createServer((req, res) => handle(req, res));
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (req, socket, head) => {
    const { pathname, query } = parse(req.url ?? "", true);
    if (pathname !== "/api/captions/stream") {
      socket.destroy();
      return;
    }

    try {
      const sessionId = typeof query.sessionId === "string" ? query.sessionId : null;
      if (!sessionId) throw new Error("sessionId is required.");

      const cookies = parseCookies(req.headers.cookie);
      const token = cookies[facilitatorCookieName(sessionId)];
      const authorized = token ? await verifyFacilitatorToken(sessionId, token) : false;
      if (!authorized) throw new Error("Not authorized for this session.");

      if (!speechToTextProvider.isConfigured || !speechToTextProvider.openStream) {
        throw new Error("Streaming speech-to-text is not configured: set STT_API_KEY.");
      }

      const session = await prisma.session.findUnique({ where: { id: sessionId } });
      if (!session || session.status !== SessionStatus.LIVE) {
        throw new Error("Start the session before streaming captions.");
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        attachCaptionSocket(ws, session);
      });
    } catch {
      socket.destroy();
    }
  });

  server.listen(port, () => {
    console.log(`> Ready on port ${port} (${dev ? "development" : "production"})`);
  });
}

main();
