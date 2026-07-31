# Do we need to move LiveKit off Railway?

**Short answer: no.** LiveKit is already not on Railway, and no hosting migration is on
the critical path to a working prototype. The thing that is broken is a WebSocket *we*
serve, on Railway's edge, and its fix is a code change measured in hours — not an infra
move measured in days.

This doc exists because "captions are broken on Railway" and "LiveKit is hosted on
Railway" got conflated. They're unrelated, and acting on the second wouldn't fix the
first. Written 2026-07-28, along
[`CAPTION_AUDIO_TROUBLESHOOTING.md`](CAPTION_AUDIO_TROUBLESHOOTING.md) §9.

## What is actually hosted where

| Piece | Where it runs today | Goes through Railway's edge proxy? |
| --- | --- | --- |
| LiveKit media/signaling server | **LiveKit Cloud** (`wss://…​.livekit.cloud`) | **No** — browsers connect to LiveKit Cloud directly |
| Caption *delivery* (server → browsers) | LiveKit Cloud data channel, `topic: "captions"`, via `RoomServiceClient.sendData` (`src/lib/providers/room.ts`) | **No** — server → LiveKit Cloud → browser |
| Caption *capture* (browser mic → server) | **Our own WebSocket**, `/api/captions/stream`, served by `server.ts` on the Railway `web` service | **Yes — and this is the only thing that does** |
| `caption-agent` worker (server-side capture; which roles is set by `CAPTION_CAPTURE_MODE`) | In-process inside the Railway `web` service; connects out to LiveKit Cloud | Outbound only |
| `local-inference`, Postgres | Railway services | Internal |

Two consequences worth stating plainly:

- **There is no LiveKit server on Railway to move.** It's LiveKit Cloud already. The
  browser's media connection never touches Railway at all — which is exactly why video
  and audio keep working in a session where captions are flickering.
- **Caption delivery is already off Railway's edge.** Only the *upload* of mic audio
  rides our own WebSocket. So the entire blast radius of the Railway edge problem is one
  direction of one feature.

## What is broken, precisely

Two separate bugs, only one of which was ours (full evidence in the troubleshooting doc):

- **B — a self-amplifying resource leak (ours, fixed).** Authorization for the caption
  socket is async; the socket was often already dead by the time `attachCaptionSocket`
  ran, and its cleanup handlers were registered too late to ever fire. Every 500ms retry
  leaked an STT stream and a 3-second Postgres-polling interval, permanently. This is
  what made a transient glitch degrade into "worked initially, then never again."
- **A — the reset itself (not ours, open).** Something inside Railway's network resets
  the connection ~2ms after the `101`. It cannot be the client: 2ms is far below a round
  trip to the browser (≥50ms from the India-South edge). The second `x-forwarded-for`
  hop changes on every reconnect, so the edge fleet is in the path and load-balancing us.

**Moving LiveKit would fix neither.** B is a lifecycle bug in our own code. A is Railway's
edge mishandling *our* WebSocket, on a path LiveKit is not part of.

## The fix ladder for A, cheapest first

Work down this list only as far as you have to. Nothing below step 2 is needed for a
prototype.

### 0. Ship the leak fix (done)

Already in the working tree. This alone may be sufficient in practice: with the leak
gone, A degrades from "poisons the process forever" to "one reconnect that either
recovers or reports a clear error." Deploy and re-measure before doing anything else —
**do not spend infra effort on A until you know it still reproduces once B is gone.**

### 1. Pick a capture mode with `CAPTION_CAPTURE_MODE` (done — set it on Railway)

**Set `CAPTION_CAPTURE_MODE=agent-all` on the Railway `web` service.** That is the whole
fix for the reported asymmetry, and it needs no code change now that the switch exists.

The asymmetry — "facilitator to learner works, learner to facilitator doesn't" — was a
direct consequence of splitting the two capture pipelines *by role*:

| Role | Captured by (before) | Working on Railway? |
| --- | --- | --- |
| Facilitator | `caption-agent` worker, server-side over LiveKit | Yes |
| Learner | Browser WebSocket → `/api/captions/stream` | **No** — 100% failure, `age=2ms` reset |

Both pipelines had to work for the product to work, so one broken transport took out
exactly half of it. The learner's browser console shows the fix landing correctly on the
other side of this — backoff now climbs 500ms → 1s → 2s → 4s → 8s and then surfaces a real
error, instead of looping at a flat 500ms — but a bounded failure is still a failure.

`CAPTION_CAPTURE_MODE` (`src/lib/caption-capture-mode.ts`) replaces the role split with a
per-deployment choice of **one** path for **all** roles:

- **`agent-all`** — the agent captures everyone; the browser WebSocket is disabled for
  every role. This routes entirely around root cause A, using the one transport that
  demonstrably works on Railway right now.
- **`agent-facilitator`** — the default, byte-for-byte the historical behavior, so nothing
  changes for anyone who doesn't opt in.
- **`browser-only`** — the agent is never started (this is the kill switch described
  below); the browser WebSocket carries everyone.

`server.ts` enforces the mode authoritatively at the upgrade, so a stale browser tab can't
bypass the client-side gating.

**One distinction is load-bearing and easy to get wrong:** `browserCaptureDisabled(role)` is
deliberately *not* `!agentCaptures(role)`. Under `agent-facilitator` the agent is the
facilitator's *primary* path and the browser stream is its *fallback* — that fallback is
what has always kept the facilitator working when the worker isn't there (no credentials,
the IPv6 `ENETUNREACH`, LiveKit's CPU-based `load_fnc` refusing the job, a dispatch that
never lands). Collapsing the two would delete it and leave the facilitator with **no**
capture path while the UI claimed captions were already running — trading a ≤3s duplicate
window that two existing guards already bound for a permanent silent failure. So only
`agent-all` forbids the browser stream. A unit test asserts that no role is ever forbidden
the browser stream unless the agent is actually assigned to capture it.

For the same reason, `captionAgentActive` is only honoured when this deployment actually
runs a worker. That flag is cleared exclusively by the worker itself, so a worker killed
without draining (a redeploy that SIGKILLs past the drain window, an OOM, a crash) leaves
it stuck `true` with nothing able to reset it — and under `browser-only` no worker is ever
started, so it would have refused the facilitator's socket for the rest of the session, in
the very mode meant to give them one.

Two caveats remain for `agent-all`:

- It makes the worker's intermittent LiveKit-connect problem load-bearing for *all*
  captions rather than just the facilitator's. If the worker can't connect, `browser-only`
  is the one-variable rollback — and vice versa. That is the point of having the switch.
  **Note (2026-07-31):** part of what presented as "the worker can't connect" was actually
  a separate, now-fixed bug — automatic (unnamed) LiveKit Agent dispatch turned out to be
  unreliable even when the worker connected and registered fine, so it silently never
  received a job for some sessions. Fixed by naming the agent and requesting its dispatch
  explicitly via `RoomConfiguration` on every issued token (see
  `docs/TRANSLATION_ARCHITECTURE.md` Part 2, `docs/CAPTION_AUDIO_TROUBLESHOOTING.md` §10).
  The genuine connectivity failure mode below (IPv6 `ENETUNREACH`) is unrelated and still open.
- There is no per-learner liveness signal (`captionAgentActive` is facilitator-scoped by
  design), so if a job dies mid-room, learner captions stop while the badge still reads
  "Live captions are already running from your mic", with no error and no automatic
  fallback. Adding a per-participant liveness signal is the follow-up if `agent-all`
  becomes the long-term default rather than a way around root cause A.

### 1b. Why turning the worker off entirely is still worth considering

Independent of A, and worth doing regardless. The worker:

- is **redundant under `browser-only`** — the browser stream covers every participant
  including the facilitator, so nothing is lost by not running it;
- is **intermittently unable to reach LiveKit Cloud** from Railway at all (documented
  IPv6 `ENETUNREACH`, troubleshooting doc "Still open");
- **fights the web server it lives in** — LiveKit's default `load_fnc` is host CPU with a
  0.7 threshold, so Next.js request traffic makes the worker refuse jobs, and agents want
  a 10+ minute SIGTERM drain where a web server wants seconds;
- adds a *third* concurrent writer to caption state (`captionAgentActive`), which is the
  root of several past bugs.

This is now `CAPTION_CAPTURE_MODE=browser-only`, which returns early from
`startCaptionAgent()` before the worker is constructed. It is the right mode **only if the
browser WebSocket is healthy in your environment** — which it is locally and is not on
Railway today, so `agent-all` is the Railway setting and this is the local/rollback one.

### 2. Authorize before completing the handshake (hours, no infra)

Today `server.ts` completes the WebSocket handshake **first** and authorizes after, so a
`101` is sent for a connection that may still be rejected — and the connection then sits
silent for the duration of several DB round trips. The leading hypothesis for A is that
the edge dislikes exactly that. Reordering so the `101` is only sent for a connection
already wired to an STT stream removes the silent window entirely.

Two cautions:

- `server.ts` deliberately does it in the current order, and its comment cites issues
  #102/#106 as the reason. **However**, that comment's supporting claim — that "a plain
  Node `ws` client hitting the exact same endpoint with the exact same delay is
  unaffected, so this is a browser-side characteristic" — is now known to be **false**: a
  Node `ws` client against a local `npm run dev` reproduces the identical
  `code=1006 reason="" openedFor=25ms`. The tradeoff should be re-tested, not treated as
  settled.
- The cost of reordering is that genuine rejections ("session not live", "not
  authorized") lose their readable close reason and become opaque handshake failures. Keep
  a real message path by failing the upgrade with an HTTP status the client can read.

**Re-run the local harness before and after.** This is the one part of the problem that
reproduces off Railway, which makes it the only part you can iterate on quickly.

### 3. Replace the WebSocket upload with HTTP chunk POSTs (1–2 days, no infra)

If A survives step 2, stop fighting the edge for a raw WebSocket and stop using one. Post
`MediaRecorder` chunks to an ordinary route handler instead. This is prototype-appropriate
and unusually cheap here because the pieces already exist:

- `speechToTextProvider.transcribeChunk` already transcribes a single recorded chunk;
- `LocalBufferingSpeechToTextStream` already handles the WebM-header-reattachment problem
  that makes second-and-later chunks independently decodable;
- caption delivery already goes out over LiveKit's data channel, so nothing downstream
  changes.

Cost: latency goes from streaming to batched — roughly 1–3s per window instead of
sub-second. For a facilitated workshop demo that is a real but acceptable regression, and
it is **immune to the entire class of problem A belongs to**, because plain HTTP POSTs
through Railway's edge are the best-tested path it has.

### 4. Move capture server-side / split the worker out (days, infra)

Only relevant post-prototype. Two variants:

- **Split `caption-agent` into its own Railway service.** Also deletes
  `@livekit/rtc-node` from the `web` image, making the IPv6 question moot for the service
  that actually serves users.
- **LiveKit Cloud Agents** (`lk agent create` / `lk agent deploy`). GA, Node is
  first-class, and rolling deploys drain active sessions for up to an hour — which Railway
  cannot do. ~$0.01 per agent-session-minute.

Note what this does *not* buy you: there is **no** hosted, agent-less server-side
transcription in LiveKit. Every LiveKit transcription path runs through an agent you own
(LiveKit Inference is a hosted *model gateway*, not a transcription service). So this
route means owning and operating a worker deployment — real work, and the right call only
once the prototype is proven.

It would, however, let you delete the browser→server audio upload entirely, which is the
only reason A exists.

## Recommendation

**For a working prototype: steps 0 and 1.** Both are done in code; step 1 needs
`CAPTION_CAPTURE_MODE=agent-all` set on the Railway `web` service and a redeploy. That
should restore captions in both directions, because it removes the broken transport from
the path entirely rather than trying to repair it.

**Update (2026-07-31): `agent-all` alone was not sufficient in practice** — it makes the
worker load-bearing for every role, so two separate worker-side bugs (`local-inference`
CPU-thread starvation under concurrent STT; unreliable automatic agent dispatch) each had
to be fixed before captions actually worked end-to-end. See
`CAPTION_AUDIO_TROUBLESHOOTING.md` §10–11. If captions are still silent after setting
`agent-all`, check those two before assuming this switch itself failed.

Only if the worker itself proves unreliable does root cause A need solving at all — and
then it is step 2 (hours), not a hosting migration. Do not start step 3 until step 2 has
been measured, and do not start step 4 before the demo.

**No hosting change is required, and "move LiveKit off Railway" is not an available
action** — it was never on Railway. The nearest real version of that idea is step 4
(moving the *agent worker* off the web service), and it is the most expensive option on
this list while addressing a failure mode that steps 0–3 can close for far less.

## If you decide to leave Railway anyway

That is a legitimate call for reasons other than this bug — Railway's edge is
undocumented territory for raw WebSockets, and you've now spent several days on it. If so,
judge candidates on **WebSocket transparency**, not on LiveKit support (irrelevant — the
browser talks to LiveKit Cloud directly):

- A platform that documents its WebSocket idle timeouts and upgrade handling explicitly.
- Or terminate WebSockets on something you control (a small VM/container with your own
  reverse proxy) and leave the rest of the app where it is — the caption socket is a
  single endpoint and could move on its own.

Both are larger changes than steps 0–3. Neither is justified until you know A survives
the leak fix.
