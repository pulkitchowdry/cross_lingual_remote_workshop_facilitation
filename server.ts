import { createServer } from "node:http";
import { parse, fileURLToPath } from "node:url";
import { loadEnvConfig } from "@next/env";
// Type-only — erased at compile time, so this doesn't need to wait on the same
// "after next initializes" ordering the runtime `@/lib/captions-socket` import below does.
import type { CaptionSpeaker } from "@/lib/captions-socket";
import type { SupportedLanguage } from "@/lib/session-contracts";

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
  const { SessionStatus, ParticipantRole } = await import("@/generated/prisma/client");
  const { facilitatorCookieName, learnerCookieName, hashToken } = await import("@/lib/session-security");
  const { speechToTextProvider } = await import("@/lib/providers/speech-to-text");
  const { AgentServer, ServerOptions, initializeLogger } = await import("@livekit/agents");

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
  const { attachCaptionSocket, closeWithReason } = await import("@/lib/captions-socket");

  /**
   * Resolves which role (if either) is authorized to stream mic audio for this
   * session over this WebSocket — the facilitator's own cookie/token, or a
   * learner's (mirroring `learnerParticipantId` in `session-access.ts`, which this
   * file can't import directly since it depends on `next/headers`' request-scoped
   * `cookies()`, not available in this raw-socket context). Facilitator is checked
   * first since it's the more common/expected caller of this fallback.
   */
  async function resolveCaptionSpeaker(sessionId: string, cookies: Record<string, string>): Promise<CaptionSpeaker | null> {
    const facilitatorToken = cookies[facilitatorCookieName(sessionId)];
    if (facilitatorToken && (await verifyFacilitatorToken(sessionId, facilitatorToken))) {
      return { role: "facilitator" };
    }
    const learnerToken = cookies[learnerCookieName(sessionId)];
    if (learnerToken) {
      const participant = await prisma.sessionParticipant.findFirst({
        where: { accessTokenHash: hashToken(learnerToken), sessionId, role: ParticipantRole.LEARNER },
        select: { id: true },
      });
      if (participant) return { role: "learner", participantId: participant.id };
    }
    return null;
  }

  const server = createServer((req, res) => handle(req, res));
  const wss = new WebSocketServer({ noServer: true });
  // Next's own dev tooling (HMR, the React DevTools bridge, etc.) upgrades
  // WebSocket connections too — most visibly `/_next/webpack-hmr`. Destroying
  // those sockets (the old behavior here) makes Next's dev client believe the
  // dev server is unreachable and fall back to `window.location.reload()`,
  // which then repeats every time the socket is killed again: a reload loop
  // that never gives any client-side effect (LiveSessionRoom's credential
  // fetch, SessionAutoRefresh's polling) a chance to finish. Delegate anything
  // that isn't our own caption stream to Next's upgrade handler instead of
  // destroying it.
  const nextUpgradeHandler = app.getUpgradeHandler();

  /**
   * Runs every auth/session check for a caption stream and wires it up on success.
   * Deliberately runs *after* the WebSocket handshake is already complete (see the
   * `wss.handleUpgrade` call below for why) — a throw here closes the already-open
   * `ws` with a reason instead of failing the handshake itself.
   */
  async function authorizeAndAttachCaptionSocket(req: import("node:http").IncomingMessage, query: import("node:querystring").ParsedUrlQuery, ws: import("ws").WebSocket) {
    const sessionId = typeof query.sessionId === "string" ? query.sessionId : null;
    if (!sessionId) throw new Error("sessionId is required.");

    const cookies = parseCookies(req.headers.cookie);
    const speaker = await resolveCaptionSpeaker(sessionId, cookies);
    if (!speaker) throw new Error("Not authorized for this session.");

    if (!speechToTextProvider.isConfigured || !speechToTextProvider.openStream) {
      throw new Error("Streaming speech-to-text is not configured: set STT_API_KEY or configure local-inference.");
    }

    const found = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!found || found.status !== SessionStatus.LIVE) {
      throw new Error("Start the session before streaming captions.");
    }
    // Authoritative server-side backstop against a duplicate STT pipeline: the
    // caption-agent worker (caption-agent.ts) auto-subscribes to the facilitator's
    // mic as soon as it's unmuted and sets `captionAgentActive` once it starts
    // streaming. The client-side guard for this (LiveCaptionStream.tsx hiding its
    // "Start" button while `agentCapturing` is true) only learns about that via
    // SessionAutoRefresh's 2s poll, so a facilitator can still click "Start" in the
    // race window right after the agent begins capturing but before the next poll
    // lands — without this check, that would open a second, independent Deepgram
    // stream for the same audio and duplicate/interleave every caption line
    // (the same class of bug issue #95 fixed client-side, now backstopped here too).
    // Facilitator-only: `captionAgentActive` has nothing to say about a learner's
    // audio (see `captions-socket.ts`'s `CaptionSpeaker` doc comment).
    if (speaker.role === "facilitator" && found.captionAgentActive) {
      throw new Error("Captions are already being captured automatically for this session.");
    }

    // Resolved here (this function is already async) rather than inside
    // `attachCaptionSocket`, which must stay synchronous — see that function's
    // own doc comment.
    const { resolveLearnerSpeaker } = await import("@/lib/speaker-resolution");
    const initialLanguage =
      speaker.role === "facilitator"
        ? (found.sourceLanguage as SupportedLanguage)
        : ((await resolveLearnerSpeaker(found.id, speaker.participantId))?.language ?? (found.sourceLanguage as SupportedLanguage));

    attachCaptionSocket(ws, found, speaker, initialLanguage);
  }

  server.on("upgrade", async (req, socket, head) => {
    const { pathname, query } = parse(req.url ?? "", true);
    if (pathname !== "/api/captions/stream") {
      nextUpgradeHandler(req, socket, head);
      return;
    }
    console.log(`[captions/stream] upgrade request received (sessionId=${query.sessionId ?? "none"})`);
    // `wss.handleUpgrade` is called immediately and synchronously here, before any
    // `await` — this is deliberate, not just style. This app's browser-mic caption path
    // has a long-standing, deployment-specific quirk (see issue #102, #106): on at
    // least some browser/OS combinations, a `ws://<host>/api/captions/stream` upgrade
    // whose completion is delayed by *any* asynchronous gap — even a same-tick
    // `setTimeout(resolve, 0)` with no real I/O, confirmed with a from-scratch
    // `http`+`ws` server carrying zero app code — gets abruptly reset (no WebSocket
    // close frame at all) instead of completing. A plain Node `ws` client hitting the
    // exact same endpoint with the exact same delay is unaffected, so this is a
    // browser-side characteristic, not a server bug — and it doesn't reproduce over
    // `wss://`, which is what every real deployment (Railway) actually serves. Calling
    // `handleUpgrade` with nothing async ahead of it at least guarantees the handshake
    // itself always completes instantly and gives every subsequent failure (below) a
    // real, reported reason instead of letting a fast local rejection race the same
    // failure mode and get misreported as "a VPN, proxy, or firewall may be blocking
    // it" — see caption-socket-client.ts's `"opaque"` classification, which is what
    // silently absorbs this class of abrupt, reasonless close.
    wss.handleUpgrade(req, socket, head, (ws) => {
      void authorizeAndAttachCaptionSocket(req, query, ws).catch((error) => {
        // Completing the handshake and closing with a reason (rather than destroying the
        // raw TCP socket) lets the browser's `WebSocket.onclose` report *why* the
        // connection didn't start (e.g. "session not live", "not authorized", "STT not
        // configured") instead of a single opaque "connection failed" for every case —
        // see LiveCaptionStream.tsx's `onclose` handler, which surfaces `event.reason`
        // when present.
        const reason = error instanceof Error ? error.message : "Unable to start captions.";
        console.error(`[captions/stream] rejecting after upgrade: ${reason}`);
        closeWithReason(ws, 1011, reason);
      });
    });
  });

  server.listen(port, () => {
    console.log(`> Ready on port ${port} (${dev ? "development" : "production"})`);
  });

  await startCaptionAgent({ AgentServer, ServerOptions, initializeLogger, dev });
}

/**
 * Registers the LiveKit Agents worker that subscribes to the facilitator's
 * audio track server-side (`src/lib/caption-agent.ts`), in the same process
 * as the Next.js app — this needs a persistent process rather than a
 * request-scoped one, which `server.ts` already is. Job dispatches spawn
 * their own subprocess (LiveKit Agents' own isolation model, preserving the
 * `tsx` loader via `execArgv` so the forked process can still load a `.ts`
 * entry file), but there's only one deployable service/`package.json` for
 * the whole app now. No-ops if LiveKit or STT credentials aren't
 * configured, so local dev without those env vars still starts cleanly.
 */
async function startCaptionAgent({
  AgentServer,
  ServerOptions,
  initializeLogger,
  dev,
}: {
  AgentServer: typeof import("@livekit/agents").AgentServer;
  ServerOptions: typeof import("@livekit/agents").ServerOptions;
  initializeLogger: typeof import("@livekit/agents").initializeLogger;
  dev: boolean;
}) {
  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
  const { speechToTextProvider } = await import("@/lib/providers/speech-to-text");
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !speechToTextProvider.isConfigured) {
    console.warn("[caption-agent] LiveKit credentials or a speech-to-text tier (STT_API_KEY / local-inference) are not configured; caption agent worker not started.");
    return;
  }

  initializeLogger({ pretty: dev, level: dev ? "debug" : "info" });
  const agentPath = fileURLToPath(new URL("./src/lib/caption-agent.ts", import.meta.url));
  const server = new AgentServer(
    new ServerOptions({
      agent: agentPath,
      // LIVEKIT_URL is given to browsers too (RoomProvider.issueCredential
      // hands it to the LiveKit client verbatim), so in Docker Compose it's
      // set to a host-reachable address; this worker instead runs inside the
      // container and needs the Compose-internal LiveKit hostname.
      // LIVEKIT_AGENT_URL overrides just this connection when the two differ
      // (see docker-compose.yml); falls back to LIVEKIT_URL otherwise.
      wsURL: process.env.LIVEKIT_AGENT_URL || LIVEKIT_URL,
      apiKey: LIVEKIT_API_KEY,
      apiSecret: LIVEKIT_API_SECRET,
      production: !dev,
      logLevel: dev ? "debug" : "info",
    }),
  );
  server.run().catch((error) => console.error("[caption-agent] worker stopped:", error));
}

main();
