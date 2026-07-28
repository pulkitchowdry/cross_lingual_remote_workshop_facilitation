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
  const { agentCaptureEnabled, browserCaptureDisabled } = await import("@/lib/caption-capture-mode");
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

  // ──────────── DIAGNOSTICS for the frameless-1006 loop — remove once A is closed ────────────
  //
  // These logs already did their job once: correlating them with the browser console proved
  // the caption socket reaches OPEN and is then reset with code 1006 and an empty reason
  // ~2ms later, and they eliminated three of the four candidate causes outright —
  //
  //   • NOT the keepalive sweep below: every dead socket shows `pings=0 pongs=0`, i.e. it
  //     died long before the first 30s sweep could ever look at it.
  //   • NOT the process restarting: `boot=` is identical across all 137 sockets of an
  //     affected session.
  //   • NOT the edge answering 101 by itself: every socket the browser saw open has its own
  //     `upgrade sock=` line here, so the upgrade does reach this process.
  //
  // What remains (A) is a reset originating inside Railway's network: `age=2ms` is far too
  // fast to be a round trip to the client (~50ms+ from the India-South edge), and the
  // second `x-forwarded-for` hop differs on every reconnect, so the edge fleet is in the
  // path and load-balanced. That is still open — see docs/CAPTION_AUDIO_TROUBLESHOOTING.md.
  //
  // The *amplifier* (B) that turned A into a permanent, worsening failure is fixed: see the
  // `readyState` guard in `authorizeAndAttachCaptionSocket` below. Keep these logs until A
  // is closed too, then delete this block, the `diag` calls in the upgrade handler, and the
  // sweep's logging.
  const bootId = Math.random().toString(36).slice(2, 8);
  console.log(`[captions/diag] boot=${bootId} pid=${process.pid} node=${process.version}`);
  // `uncaughtExceptionMonitor` (not `uncaughtException`) observes without installing a
  // handler, so the process still exits exactly as it would have — a diagnostic must not
  // change the very behavior it's measuring. `unhandledRejection` has no monitor variant,
  // so it rethrows to preserve Node's default crash semantics.
  process.on("uncaughtExceptionMonitor", (error) => console.error(`[captions/diag] boot=${bootId} uncaughtException:`, error));
  process.on("unhandledRejection", (reason) => {
    console.error(`[captions/diag] boot=${bootId} unhandledRejection:`, reason);
    throw reason;
  });

  type CaptionSocketDiag = { id: string; sessionId: string; upgradeAtMs: number; openAtMs: number; binaryFrames: number; textFrames: number; bytes: number; pongs: number; pings: number; lastFrameAtMs: number };
  const captionSocketDiag = new WeakMap<import("ws").WebSocket, CaptionSocketDiag>();
  let captionSocketSeq = 0;
  const sinceMs = (from: number) => `${Date.now() - from}ms`;
  function diagLine(ws: import("ws").WebSocket): string {
    const d = captionSocketDiag.get(ws);
    if (!d) return "sock=? (untracked)";
    return `sock=${d.id} boot=${bootId} age=${sinceMs(d.upgradeAtMs)} sinceFrame=${d.lastFrameAtMs ? sinceMs(d.lastFrameAtMs) : "never"} binary=${d.binaryFrames} text=${d.textFrames} bytes=${d.bytes} pings=${d.pings} pongs=${d.pongs}`;
  }
  // ──────────────────────────── end temporary diagnostics ────────────────────────────

  /**
   * WebSocket-level liveness for `/api/captions/stream`. Neither `ws` nor the browser
   * sends keepalive pings on its own, and a TCP connection that dies without a FIN (a
   * laptop sleeping, a phone losing signal, a NAT/proxy dropping the flow — all routine
   * on mobile, and Railway publishes no egress idle timeout) leaves the server side
   * OPEN indefinitely. That orphan used to hold this session's entry in
   * `activeCaptionStreamSockets` (declared below) forever, and it still pins an STT
   * stream (a paid Deepgram connection, or a local-inference flush timer) that nothing
   * is feeding. That map's eviction policy fixes the caption-blocking symptom; this
   * sweep is what reclaims the resources.
   *
   * `wss.clients` is populated even though this server is `noServer: true` and never
   * emits its own `connection` event — `ws`'s `completeUpgrade` (reached via
   * `handleUpgrade` below) adds to it whenever `clientTracking` is on, which is the
   * default.
   */
  const CAPTION_SOCKET_PING_INTERVAL_MS = 30_000;
  const captionSocketAlive = new WeakSet<import("ws").WebSocket>();
  const captionSocketKeepalive = setInterval(() => {
    for (const client of wss.clients) {
      // Missed the previous round's pong — the peer is gone, so drop it. `terminate()`
      // (not `close()`) because a half-open socket will never complete a close
      // handshake; this fires the `close` event that runs `releaseSpeakerKey` and
      // tears down the STT stream (`captions-socket.ts`'s own `close` handler).
      if (!captionSocketAlive.has(client)) {
        // TEMPORARY DIAGNOSTIC: this is candidate (1) for the frameless 1006 — if this line
        // appears ~30s before each client-side "SOCKET CLOSED", the sweep is the killer, and
        // `binary=`/`pongs=` say whether it killed a socket that was actually still healthy.
        console.warn(`[captions/diag] keepalive TERMINATE (missed pong) ${diagLine(client)}`);
        client.terminate();
        continue;
      }
      captionSocketAlive.delete(client);
      const diag = captionSocketDiag.get(client);
      if (diag) diag.pings += 1;
      client.ping();
    }
  }, CAPTION_SOCKET_PING_INTERVAL_MS);
  // Nothing here should keep the process alive on its own if the HTTP server is closing.
  captionSocketKeepalive.unref();
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
   * Tracks the ONE live `/api/captions/stream` socket per speaker identity, so two
   * concurrent connections for the same speaker never run independent STT pipelines
   * against the same speech and duplicate every caption line (the same bug class the
   * `captionAgentActive` check below guards against for the LiveKit caption-agent
   * worker vs. a browser-mic socket, which has nothing to say about two browser-mic
   * sockets racing each other). In-memory only, matching this app's
   * single-persistent-process architecture (same as `captionAgentActive`'s own
   * duplicate-guard state) — no DB table needed.
   *
   * A newer connection EVICTS the older one (last-writer-wins) rather than being
   * rejected. Rejecting was a permanent, unrecoverable deadlock in production: the
   * client (`LiveCaptionStream.tsx`) remounts on every captions-tab switch and reopens
   * this socket, and `WebSocket.close()` only *initiates* a close — the server's own
   * `close` event (the only thing that used to free this entry) lands a network
   * round-trip later. Any remount fast enough to beat that, or any client that lost its
   * socket reference without closing it, left an orphaned-but-OPEN socket holding the
   * entry forever, since nothing here pings for liveness. Every subsequent attempt was
   * then refused with "Another caption stream is already active for this speaker" — the
   * exact `upgrade received` → `rejecting after upgrade` loop seen in Railway's logs,
   * with captions dead for the rest of the session. Eviction makes a reconnect
   * authoritative, which is the semantic a reconnect actually wants: the newest socket
   * is the one with a live `MediaRecorder` behind it.
   */
  const activeCaptionStreamSockets = new Map<string, import("ws").WebSocket>();
  function captionStreamSpeakerKey(sessionId: string, speaker: CaptionSpeaker): string {
    return speaker.role === "facilitator" ? `${sessionId}:facilitator` : `${sessionId}:learner:${speaker.participantId}`;
  }

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
    // `agentCaptureEnabled()` qualifies the flag deliberately. `captionAgentActive` is only
    // ever cleared by the worker itself (`clearCaptionAgentCapturing`, from its per-stream
    // `finally` and its shutdown callback), so a worker killed without draining — a Railway
    // redeploy that SIGKILLs past the drain window, an OOM, a crash — leaves it stuck `true`
    // in Postgres with nothing able to reset it. If the deployment then switches to
    // `browser-only` (the documented one-variable rollback), no worker is ever started, so
    // nothing can clear the flag and this check would refuse the facilitator's socket for the
    // rest of the session — locking them out of captions in the very mode that exists to give
    // them one. A stale flag from a worker this deployment doesn't run says nothing about
    // whether anything is capturing, so it must not gate anything.
    if (speaker.role === "facilitator" && agentCaptureEnabled() && found.captionAgentActive) {
      throw new Error("Captions are already being captured automatically for this session.");
    }
    // Authoritative counterpart to the client-side gating in the room pages: under
    // `agent-all` the LiveKit worker owns every role's audio, so this socket must never
    // carry any. Unlike the `captionAgentActive` check above — which is facilitator-scoped
    // and only true once the worker has actually begun capturing — this is a static
    // deployment fact, so it holds for learners too and needs no per-participant state.
    // Without it, a stale browser tab (or a client that ignores the prop) could still open
    // a second pipeline for a speaker the agent is already transcribing, which is the
    // duplicate-caption bug this app has hit repeatedly. Scoped to `agent-all` only — see
    // `browserCaptureDisabled`'s doc comment for why the facilitator's fallback must survive
    // in the default mode.
    if (browserCaptureDisabled(speaker.role)) {
      throw new Error("Captions for this session are captured automatically; the browser microphone stream is disabled.");
    }

    // Resolved here (this function is already async) rather than inside
    // `attachCaptionSocket`, which must stay synchronous — see that function's
    // own doc comment.
    const { resolveLearnerSpeaker } = await import("@/lib/speaker-resolution");
    const initialLanguage =
      speaker.role === "facilitator"
        ? (found.sourceLanguage as SupportedLanguage)
        : ((await resolveLearnerSpeaker(found.id, speaker.participantId))?.language ?? (found.sourceLanguage as SupportedLanguage));

    // Everything above this point is async — several DB round trips and a dynamic import,
    // which measured ~470ms cold and ~6ms warm. The socket can therefore already be DEAD by
    // the time we get here, and in production it reliably is: Railway's logs show
    // `CLOSED code=1006 age=2ms` landing *before* `attached age=6ms`, every cycle.
    //
    // Continuing past this point on a closed socket is what turned a transient failure into
    // a permanent one. `attachCaptionSocket` registers its `ws.on("close")`/`ws.on("error")`
    // cleanup handlers *at the end*, and a listener added after `ws` has already emitted
    // `close` is never called — so every one of these cycles permanently leaked:
    //
    //   • an STT stream (a paid Deepgram socket, or a local-inference flush timer) that
    //     `sttStream.close()` never ran on, and
    //   • for a facilitator, a 3-second `setInterval` hammering Postgres forever
    //     (`duplicateGuardInterval`), never cleared, and
    //   • the `activeCaptionStreamSockets` entry, since `releaseSpeakerKey` was likewise
    //     registered too late to ever run.
    //
    // With the client retrying every 500ms that compounds without bound — by socket #137 in
    // one observed session that's 137 orphaned STT streams and ~46 junk queries/second — which
    // is exactly the reported "worked initially, then suddenly started flickering and never
    // recovered". The trigger for the first close is a separate question (see the doc); this
    // guard is what stops one bad connection from poisoning the process.
    if (ws.readyState !== ws.OPEN) {
      console.warn(`[captions/stream] socket closed during authorization (readyState=${ws.readyState}); not attaching an STT stream to it.`);
      return;
    }

    // From here down everything is synchronous, so this evict-then-claim is atomic against a
    // second connection attempt for the same speaker racing this one — no `await` runs
    // between reading the previous socket and installing this one below.
    const speakerKey = captionStreamSpeakerKey(sessionId, speaker);
    const superseded = activeCaptionStreamSockets.get(speakerKey);
    activeCaptionStreamSockets.set(speakerKey, ws);
    if (superseded) {
      // 1012 ("service restart") rather than 1011: this is an orderly handover, not an
      // error, and it carries a reason so the *evicted* client reports something
      // specific instead of a generic "disconnected". That client has already been
      // replaced by this newer socket in the same browser, so in practice nothing is
      // listening to it — but a second tab/device genuinely losing the stream should say
      // why. Closed AFTER this socket claims the entry above so the guard below sees the
      // map already pointing at `ws` and can't clobber it.
      console.log(`[captions/stream] superseding an older caption stream for ${speakerKey} (evicted ${diagLine(superseded)}, in favour of ${diagLine(ws)})`);
      closeWithReason(superseded, 1012, "Superseded by a newer caption stream for this speaker.");
    }
    // Only free the entry if it still points at THIS socket. Without the guard, the
    // evicted socket's own `close` event (which fires after the newer socket has already
    // claimed the key) would delete the *newer* socket's entry, silently reintroducing
    // the duplicate-pipeline bug this map exists to prevent.
    const releaseSpeakerKey = () => {
      if (activeCaptionStreamSockets.get(speakerKey) === ws) activeCaptionStreamSockets.delete(speakerKey);
    };
    ws.on("close", releaseSpeakerKey);
    ws.on("error", releaseSpeakerKey);

    attachCaptionSocket(ws, found, speaker, initialLanguage);
    // TEMPORARY DIAGNOSTIC: proves the socket was fully wired to an STT stream, so any
    // later close is a *live* connection dying rather than a rejection in disguise.
    console.log(`[captions/diag] attached speaker=${speakerKey} lang=${initialLanguage} mode=${found.translationMode} ${diagLine(ws)}`);
    // The client cannot tell a usable socket from a useless one on its own: reaching `OPEN`
    // only means the 101 arrived, and the authorization above happens *after* that. A socket
    // that opens and is then reset before it's ever attached looked, to
    // `LiveCaptionStream`, exactly like a healthy connection that dropped — so it reset the
    // reconnect ladder on every cycle, `MAX_RECONNECT_ATTEMPTS` was unreachable, and the
    // retry loop ran at a flat 500ms forever (the observed flicker). This frame is the only
    // honest "this connection can actually carry captions" signal, so it's what the client
    // resets its ladder on instead.
    ws.send(JSON.stringify({ type: "ready" }));
  }

  server.on("upgrade", async (req, socket, head) => {
    const { pathname, query } = parse(req.url ?? "", true);
    if (pathname !== "/api/captions/stream") {
      nextUpgradeHandler(req, socket, head);
      return;
    }
    console.log(`[captions/stream] upgrade request received (sessionId=${query.sessionId ?? "none"})`);
    // TEMPORARY DIAGNOSTIC: candidate (4) — if a client-side "SOCKET CLOSED" has no matching
    // `sock=` line here at all, the 101 the browser saw was synthesized by the edge and this
    // process never received the upgrade. `x-forwarded-*`/`via` say what's in the path.
    const upgradeAtMs = Date.now();
    const socketId = `s${++captionSocketSeq}`;
    console.log(
      `[captions/diag] upgrade sock=${socketId} boot=${bootId} sessionId=${query.sessionId ?? "none"}` +
        ` xff=${req.headers["x-forwarded-for"] ?? "-"} xfproto=${req.headers["x-forwarded-proto"] ?? "-"} via=${req.headers["via"] ?? "-"}` +
        ` ext=${req.headers["sec-websocket-extensions"] ?? "-"} ua=${(req.headers["user-agent"] ?? "-").slice(0, 60)}`,
    );
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
      // Seeded alive so the first keepalive sweep doesn't terminate a socket that simply
      // hasn't been pinged yet, then re-marked on every pong (and on any inbound frame —
      // a client actively streaming audio is self-evidently alive, and some proxies
      // forward data frames while dropping control frames).
      captionSocketAlive.add(ws);
      // ─── TEMPORARY DIAGNOSTICS for this socket's whole lifetime ───
      const diag: CaptionSocketDiag = {
        id: socketId,
        sessionId: typeof query.sessionId === "string" ? query.sessionId : "none",
        upgradeAtMs,
        openAtMs: Date.now(),
        binaryFrames: 0,
        textFrames: 0,
        bytes: 0,
        pongs: 0,
        pings: 0,
        lastFrameAtMs: 0,
      };
      captionSocketDiag.set(ws, diag);
      console.log(`[captions/diag] handshake complete (101 sent) sock=${socketId} boot=${bootId} handshake=${sinceMs(upgradeAtMs)}`);
      ws.on("pong", () => {
        diag.pongs += 1;
        // The FIRST pong is the one that matters: it proves WS control frames survive the
        // path between this process and the browser, which is what candidate (3) turns on.
        if (diag.pongs === 1) console.log(`[captions/diag] first pong ${diagLine(ws)}`);
        captionSocketAlive.add(ws);
      });
      ws.on("message", (data, isBinary) => {
        const size = Buffer.isBuffer(data) ? data.byteLength : 0;
        if (isBinary) {
          diag.binaryFrames += 1;
          diag.bytes += size;
          // Audio actually arriving is the difference between "the socket is fine but STT is
          // broken" and "the socket dies before a single chunk lands" — the client-side logs
          // cannot tell those apart, and they point at completely different root causes.
          if (diag.binaryFrames === 1) console.log(`[captions/diag] first audio chunk (${size}B) ${diagLine(ws)}`);
        } else {
          diag.textFrames += 1;
        }
        diag.lastFrameAtMs = Date.now();
        captionSocketAlive.add(ws);
      });
      ws.on("close", (code, reason) => {
        console.log(`[captions/diag] CLOSED code=${code} reason="${reason.toString().slice(0, 120)}" ${diagLine(ws)}`);
      });
      ws.on("error", (error) => {
        console.error(`[captions/diag] SOCKET ERROR ${diagLine(ws)}:`, error);
      });
      // ─── end temporary diagnostics ───
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
  const { agentCaptureEnabled: workerEnabled, captionCaptureMode } = await import("@/lib/caption-capture-mode");
  // The kill switch. Beyond routing around a broken transport, not starting this worker
  // takes a whole class of failure out of the web process: it no longer competes for the
  // CPU budget LiveKit's own default `load_fnc` measures (Next.js request traffic makes
  // the worker refuse jobs), no longer wants a 10-minute SIGTERM drain from a server that
  // wants seconds, and can no longer write `captionAgentActive` from a forked subprocess.
  if (!workerEnabled()) {
    console.log(`[caption-agent] CAPTION_CAPTURE_MODE=${captionCaptureMode()}; caption agent worker not started (browser microphone stream carries every role).`);
    return;
  }
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
