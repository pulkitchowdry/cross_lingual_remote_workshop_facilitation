# Live Caption & Translated-Audio Troubleshooting

A postmortem for the "captions don't work / wrong audio plays / TTS is silent"
issues hit while testing bidirectional live translation on Railway on
2026-07-27, across several rapid commits on `feature/speech-to-text-livekit`
and `staging`. Written after the fact from the actual commit history and
current code, not just one person's/session's view of it — several different
fixes (some by other contributors, one full revert) landed the same day, so
this is the reconciled picture.

## Timeline (commits, chronological)

| Commit | What |
| --- | --- |
| `8042c35` | Generalized `caption-agent.ts` (the server-side LiveKit worker) to capture *any* participant's mic, not just the facilitator's — the start of bidirectional translation. Also added `DuckedRoomAudio`, `SyncParticipantLanguageAttribute`, `use-speaker-languages`. |
| `c1cf39b` | Tied `LiveCaptionStream` to the mic-mute toggle (removed the separate "Start captions" button); first attempt at the TTS-autoplay-block fix. |
| `1aac00b` (#143) | Merged the above into `staging`. |
| `3c808ba` | Facilitator-name-in-captions fix, Whisper VAD/hallucination fix, the ducked-volume falsy-zero fix, **and** a mic-capture rewrite in `LiveCaptionStream.tsx` (getUserMedia → clone LiveKit's track) — see below, this last part broke captions entirely and was reverted. |
| `388194a` (#145) | 27-agent UAT audit. Root-caused **duplicate learner audio capture**: `caption-agent.ts` and the browser-mic fallback were both capturing a learner's mic with no de-dup guard between them. Fix: `caption-agent.ts` no longer subscribes to learner tracks at all — the browser-mic fallback is now the **sole** capture path for learners. |
| `823d978` (#149) | 44-agent UAT audit. Root-caused **silent TTS**: `TranslatedAudioPlayer` simply didn't render when `textToSpeechProvider.isConfigured` was false, with no indication why. Added an explicit "audio unavailable" message, a retry-with-backoff around the local Piper tier, and a `preferredLanguage`-change reconciliation effect. |
| `15dc5b2` (#151, fixes #150) | Root-caused a **language-attribute sync race**: `SyncParticipantLanguageAttribute` called `setAttributes()` in a mount effect, but `<LiveKitRoom>` publishes `localParticipant` via context as soon as the `Room` object is *constructed* — before `room.connect()` resolves. The first sync on every join raced the signaling handshake and LiveKit rejected it ("cannot send signal request before connected"). Fixed by gating on `ConnectionState.Connected` via `useConnectionState`. |
| `264ef91` | Reverted `823d978`'s changes to `LiveCaptionStream.tsx`/`i18n.ts` specifically — that part "resulted in a degraded output and did not fix the issue as expected." |
| `37a55d5` (#153) | Deduped `LiveTranscriptFeed` entries by id (a React key warning, downstream symptom of segments arriving more than once — see the duplicate-capture root cause above). |

## Root causes fixed

### 1. Duplicate audio capture for learners (the main cause of "inconsistent on Chrome")

**Symptom:** a learner's captions/translated audio worked sometimes and not
others, on the same browser, with no code change in between — "it somehow
worked" on a later attempt.

**Root cause:** for a window on 2026-07-27, `caption-agent.ts` (the
server-side LiveKit Agents worker) subscribed to *every* participant's mic —
facilitator and learner alike — while the browser-mic WebSocket fallback
(`LiveCaptionStream.tsx`) *also* auto-starts for every participant the moment
their mic is unmuted. Nothing guarded against both running for the same
learner at once: the one de-dup mechanism that exists,
`Session.captionAgentActive`, is explicitly facilitator-scoped (see
`server.ts`'s comment: *"Facilitator-only: `captionAgentActive` has nothing
to say about a learner's audio"*) — it predates `caption-agent.ts` ever
touching learner tracks, so it was never extended to cover them.

Whether this actually manifested for a given learner also depended on the
LiveKit Cloud connectivity issue below being intermittent — `caption-agent.ts`
sometimes failed to connect, sometimes didn't. When it failed to connect,
only the browser fallback ran, cleanly. When it connected, both pipelines ran
for the same learner, producing duplicate/interleaved transcript segments and
double load on local-inference/Deepgram — which is exactly the "sometimes
broken, sometimes not, for no apparent reason" pattern reported.

**Fix (`388194a`):** `caption-agent.ts` no longer subscribes to learner
tracks at all. The browser-mic fallback (`LiveCaptionStream.tsx`) is now the
**sole** capture path for learners, unconditionally — no race is possible
because there's only one path. The server-side agent still handles the
facilitator only, same as originally.

**This is the direct answer to "why was it inconsistent on Chrome":** it
should no longer be, as of `388194a` — the duplicate path was removed rather
than patched with another guard.

**Revisited (2026-07-28): learner captions re-added to `caption-agent.ts`, this
time with a per-participant guard.** Making the browser-mic WebSocket the
*sole* learner path also meant learners had no redundancy: unlike the
facilitator (server-side agent + browser fallback), a learner's captions
depended entirely on that one WebSocket surviving — see root cause #9 below,
which kills that exact connection for everyone, but only the learner had no
fallback to fall back to. This asymmetry was the actual explanation for
"facilitator→learner captions work, learner→facilitator don't."

The fix this time is per-participant de-dup instead of removing the path:
`SessionParticipant.agentCapturing` (new column, unlike the facilitator's
single per-session `Session.captionAgentActive`) lets the agent flag exactly
which learner it's currently capturing, so `LiveCaptionStream.tsx`/
`captions-socket.ts` stand down only for that specific learner rather than
needing an all-or-nothing guard. See `caption-agent.ts`'s top-of-file doc
comment and `markLearnerCaptionAgentCapturing` in `caption-source-state.ts`
for the mechanism.

### 2. Ducked (muted) raw audio randomly becoming audible again

**Root cause:** `DuckedRoomAudio.tsx` mutes a differently-languaged speaker's
raw mic by setting `<AudioTrack volume={0}>`. `livekit-client`'s own
`RemoteAudioTrack.attach()` re-applies a previously-set volume to a freshly
(re-)attached element via `if (this.elementVolume) { this.setVolume(...) }`
— and `0` is falsy in JavaScript, so this check silently skips the reapply.
Any later re-attach of the same track (e.g. `useTracks()` handing it a new
but equivalent `TrackReference` object on an unrelated room event) reset the
element to the DOM's default volume of `1` — full, unducked volume — with no
further render to correct it. This is a bug in the installed
`livekit-client` version, not in this app's own logic.

**Fix (`3c808ba`):** duck to `0.0001` instead of literal `0` — inaudible to
a human ear, but stays truthy, so the library's own reapply-on-reattach path
keeps working. See `DuckedRoomAudio.tsx`'s `DUCKED_VOLUME` constant.

### 3. A participant's spoken language never reliably reaching other clients

**Root cause:** `SyncParticipantLanguageAttribute` pushed
`localParticipant.setAttributes({ preferredLanguage })` in a plain mount
effect. `<LiveKitRoom>` publishes `localParticipant` via React context the
moment the `Room` object is *constructed*, not once `room.connect()` actually
resolves — so the very first sync on every single join raced the signaling
handshake and LiveKit rejected it outright ("cannot send signal request
before connected"). Depending on timing, other participants could be looking
at a stale/missing `preferredLanguage` attribute for a speaker, which is what
`DuckedRoomAudio`/`TranslatedAudioPlayer` use to decide whether to duck/dub
at all — compounding bug #2 above (even a correct `DUCKED_VOLUME` fix does
nothing if the attribute needed to decide "duck or not" never arrived).

**Fix (`15dc5b2`):** gate the effect on `useConnectionState() ===
ConnectionState.Connected`, so it only fires once signaling is actually
established.

### 4. TTS silently doing nothing, no explanation

**Root cause:** `TranslatedAudioPlayer` was wrapped in
`{textToSpeechProvider.isConfigured && <TranslatedAudioPlayer .../>}` on both
room pages — when TTS wasn't configured (no `TTS_API_KEY`, no
`LOCAL_INFERENCE_URL`/`LOCAL_INFERENCE_SECRET`), the component simply never
rendered, with nothing on screen to say why. This reads exactly like "the
translation feature is broken," not "it isn't turned on yet."

**Fix (`823d978`):** the same condition now renders an explicit "audio
translation unavailable" message (`learner.audioUnavailable` /
`facilitator.audioUnavailable` in `i18n.ts`) instead of nothing, plus a retry
with backoff (`LOCAL_SYNTHESIZE_ATTEMPTS = 2`) around the local Piper tier so
a single transient local-inference timeout doesn't immediately burn a paid
ElevenLabs call, and a `preferredLanguage`-change reconciliation effect so a
mid-session language switch doesn't leave a stale dub talking over newly
un-ducked live audio.

### 5. STT hallucinating text during silence/background noise ("Thank you", "Subtitles by...", "You")

**Root cause:** a well-documented Whisper failure mode — it invents stock
phrases (video-subtitle credits, "thank you for watching," filler words like
"You") when fed audio with no real speech in it. `local-inference`'s
`whisper.py` had no VAD and inspected none of faster-whisper's own
per-segment confidence signals (`no_speech_prob`, etc.) before returning
whatever it produced.

**Fix (`3c808ba`):** `vad_filter=True` (Silero VAD, bundled with
faster-whisper via its `onnxruntime` dependency — no extra install needed) so
Whisper is only ever handed audio actually believed to contain speech, plus a
defense-in-depth filter dropping any segment where
`no_speech_prob >= NO_SPEECH_THRESHOLD (0.6)`.

### 6. Facilitator captions showing generic "Speaker" instead of a name

**Root cause:** every facilitator-originated segment (`caption-agent.ts`,
the browser-mic fallback, and typed captions) persisted `speakerId: null`,
and the render side falls back to a generic `"Speaker"` string whenever
`speakerId` is null. Learner segments already carried the learner's real
display name the same way.

**Fix (`3c808ba`):** all three facilitator-originated code paths now include
the session's `facilitator` relation and persist
`` `${session.facilitator.displayName} (Facilitator)` `` as `speakerId`.

### 7. A same-day regression: replacing `getUserMedia()` with a track clone

**What was attempted:** `LiveCaptionStream.tsx` opened its own
`getUserMedia({audio:true})` completely independently of LiveKit's own mic
capture (which runs the moment the room mic is unmuted, via the same
trigger). Two concurrent `getUserMedia` captures of the same physical mic
from one tab is a known source of failures on iOS Safari and some Android
browsers (`livekit-client`'s own source carries a comment citing WebKit bug
179363 about exactly this). The attempted fix cloned the `MediaStreamTrack`
LiveKit already had open (`useLocalParticipant().microphoneTrack`) instead of
requesting a second capture.

**What actually happened:** this broke captions **on every browser**,
not just iOS Safari — both a macOS Chrome facilitator and an iPhone Safari
learner saw a "Live captions disconnected. Try again" error, in a repeating
loop (`[captions/stream] upgrade request received` logged in a tight burst
server-side with no further processing after it). Since it broke desktop
Chrome too, the iOS-only contention theory can't be the whole story for why
this particular implementation failed — the most likely explanation is a
reconnect loop in the auto-start effect's dependency on `microphoneTrack`
(a value that can change reference identity far more often than the mic
actually toggles), though this was never root-caused in isolation before
being reverted.

**Fix:** reverted back to the plain `getUserMedia()` implementation
(`264ef91` and an earlier uncommitted revert of the same file). **The
underlying iOS Safari problem this was trying to fix is still open** — see
below.

### 8. The per-speaker caption lock deadlocking a session permanently (2026-07-28)

**Symptom:** "live captions are not available, try again" for most participants, most
of the time, on Railway. The reported wording maps to `captions.connectionFailed`
("Live captions disconnected. Try again…"), i.e. `classifyCaptionSocketClose`
returning `kind: "dropped"` — the socket *opened*, then closed with a non-1000 code
and an **empty** reason.

**The log signature** (Railway, `web`):

```
[captions/stream] upgrade request received (sessionId=X)
[captions/stream] upgrade request received (sessionId=X)
[captions/stream] rejecting after upgrade: Another caption stream is already active for this speaker.
[captions/stream] upgrade request received (sessionId=X)
[captions/stream] rejecting after upgrade: Another caption stream is already active for this speaker.
   … repeating indefinitely
```

**Root cause:** `server.ts`'s duplicate-capture guard was a `Set<string>` of speaker
keys that **rejected** a second connection for the same speaker, and the entry was
freed *only* by the server-side `ws` `close`/`error` event. Three things combined:

1. **`WebSocket.close()` only initiates a close.** The server's `close` event — the
   only thing that freed the entry — lands a network round-trip later.
2. **`LiveCaptionStream` remounts routinely.** `MeetingSidebar` renders
   `captionsHeader` only while `tab === "captions"`, so switching to Chat/Analytics
   and back unmounts and remounts it; its unmount cleanup calls `stop()` (async close)
   and the new mount calls `start()` immediately. Any remount fast enough to beat the
   old socket's close was refused.
3. **No liveness detection.** Neither `ws` nor the browser pings on its own, and there
   was no keepalive here — so a socket whose peer vanished without a FIN (phone losing
   signal, laptop sleeping, proxy dropping the flow) stayed OPEN **forever**, holding
   the speaker key and pinning an STT stream nothing was feeding.

Once any orphan existed, every subsequent attempt for that speaker was refused for the
rest of the session, with no recovery path — and the client made it terminal by
rendering the error and giving up rather than retrying.

**Fix:**

- **`server.ts`: last-writer-wins instead of reject.** `activeCaptionStreamSpeakers`
  (a `Set`) became `activeCaptionStreamSockets` (a `Map<string, WebSocket>`); a newer
  connection **evicts** the older one with close code `1012` and a reason. This is the
  semantic a reconnect actually wants — the newest socket is the one with a live
  `MediaRecorder` behind it. The release callback is guarded to only delete the entry
  if it still points at *that* socket, so the evicted socket's own late `close` event
  can't clobber the newer socket's claim.
- **`server.ts`: WebSocket keepalive.** A 30s ping/pong sweep over `wss.clients`
  `terminate()`s any socket that missed the previous round's pong, which fires `close`
  and so releases the speaker key *and* tears down the STT stream. (`wss.clients` is
  populated even under `noServer: true` — `ws`'s `completeUpgrade` adds to it whenever
  `clientTracking` is on, the default.)
- **`LiveCaptionStream.tsx`: bounded automatic reconnect.** A non-user-initiated close
  now retries with exponential backoff (500ms → 8s, 5 attempts, ladder reset on every
  socket that reaches `OPEN`) instead of dying at the first drop. Close code `1012` is
  special-cased to tear down *silently* — a newer socket in the same browser already
  owns the stream, and retrying would evict it, which would retry and evict this one,
  ping-ponging forever. A `server-reason` close is never retried (the verdict won't
  change on its own and its message is already actionable); only "opaque"/"dropped"
  closes are.
- The retry policy lives in `caption-socket-client.ts`'s `decideCaptionSocketReconnect`
  as a pure function, unit-tested alongside `classifyCaptionSocketClose` — no live
  socket, `MediaRecorder`, or fake timers needed.

**Not yet addressed (deliberately):** `LiveCaptionStream` still unmounts on a
captions-tab switch. With eviction + backoff that now recovers cleanly instead of
deadlocking, but hoisting the socket into a provider so it survives tab switches would
remove the churn entirely — the better long-term fix.

### 9. The frameless-1006 reconnect loop: a self-amplifying resource leak (2026-07-28)

**Symptom:** the caption status indicator flickers on/off indefinitely. Reported as
"worked for the first attempt but after that never worked again", and in a later test
"worked initially and then all of a sudden started flickering" — i.e. a session that
starts healthy and degrades irreversibly. Client console, repeating every ~500ms:

```
[captions] START
[captions] SOCKET CLOSED {code: 1006, reason: '', wasClean: false, stoppedByUser: false, hasOpened: true}
[captions] recovery {kind: 'reconnect', delayMs: 500}
[captions] STOP
```

**This is the same underlying close as §8**, which describes "the socket *opened*, then
closed with a non-1000 code and an **empty** reason" — the identical signature. §8's
eviction + keepalive + bounded-reconnect work fixed a real deadlock, but it changed the
*presentation* of this failure (one terminal error became a self-healing loop) rather
than its cause. There are two separate bugs, and only one of them is ours.

#### What the evidence establishes

`1006` + empty reason means the browser never received a close frame, which rules out
every orderly close this app performs — `closeWithReason` (1011 + text), the 1012
eviction handover, and `captions-socket.ts`'s `onError` all carry a reason. So no
auth/session/STT-tier explanation fits, and `delayMs: 500` on every single cycle
independently proves the socket reaches `OPEN` each time.

Correlating the Railway `web` log with the browser console (server-side per-socket
logging added for this, `[captions/diag]`) gave the decisive ordering:

```
[captions/diag] upgrade sock=s137 boot=2e2zll xff=202.94.70.53, 152.233.15.120 xfproto=https
[captions/diag] handshake complete (101 sent) sock=s137 handshake=0ms
[captions/diag] CLOSED code=1006 reason="" sock=s137 age=2ms  binary=0 bytes=0 pings=0 pongs=0
[captions/diag] attached speaker=…:facilitator                sock=s137 age=6ms
```

That eliminated three of the four candidates outright:

- **Not the keepalive sweep.** Every dead socket reports `pings=0 pongs=0` — it died
  ~2ms in, long before the first 30s sweep could look at it.
- **Not the process restarting.** `boot=2e2zll` is identical across all 137 sockets.
- **Not the edge answering `101` by itself.** Every socket the browser saw open has its
  own `upgrade sock=` line server-side.
- **Not STT.** `binary=0 bytes=0` on every socket: no audio ever reached the server, so
  Deepgram/local-inference were never in the picture.

**Reproduced locally**, with no Railway proxy and no browser: a Node `ws` client against
`npm run dev` produced `code=1006 reason="" openedFor=25ms` on a seeded LIVE session.
Worth noting because `server.ts`'s pre-existing comment (issue #102/#106) asserts "a
plain Node `ws` client hitting the exact same endpoint with the exact same delay is
unaffected, so this is a browser-side characteristic" — that conclusion is wrong.

#### Root cause B (ours, fixed): every failed cycle permanently leaked resources

`authorizeAndAttachCaptionSocket` is async — several DB round trips plus a dynamic
import, measured at ~470ms cold and ~6ms warm. The socket can therefore already be
**dead** when `attachCaptionSocket` runs, and in production it reliably was (`CLOSED
age=2ms` preceding `attached age=6ms`, every cycle).

`attachCaptionSocket` registers its cleanup as `ws.on("close")` / `ws.on("error")` **at
the end**. `ws` emits `close` exactly once, and a listener added afterwards is never
called. So on every one of those cycles the code opened resources and then installed
handlers that could never fire, permanently leaking:

- an **STT stream** — a paid Deepgram socket, or a local-inference flush timer —
  that `sttStream.close()` never ran on;
- for a facilitator, the 3-second `duplicateGuardInterval` **hammering Postgres
  forever**, never cleared;
- the `activeCaptionStreamSockets` entry, since `releaseSpeakerKey` was likewise
  registered too late to run — which is why every `superseding an older caption
  stream …` line in the log evicts a socket that died 540ms earlier.

With the client retrying every 500ms this compounds without bound. At socket #137 in one
observed session that is 137 orphaned STT streams and ~46 junk queries/second, all from
one initial glitch. **This is what made the failure permanent and progressive** — the
exact "worked initially, then never again" shape, and a positive feedback loop with a
knee rather than a steady failure rate.

**Fix:** a `ws.readyState !== ws.OPEN` guard in `authorizeAndAttachCaptionSocket` before
it claims the speaker key or attaches anything, plus a backstop at the end of
`attachCaptionSocket` (in the module that owns those resources, so a future caller can't
reintroduce the leak). Verified live — 6/6 simulated cycles hit the guard with zero
attachments and zero leaked intervals — and covered by a unit test that fails without
the backstop.

**Also fixed: the flicker was unbounded.** `LiveCaptionStream` reset its reconnect ladder
in `onopen`, but reaching `OPEN` only means the 101 arrived — authorization happens
after. A socket that opened and was reset before ever being attached therefore reset the
ladder on every cycle, making `MAX_RECONNECT_ATTEMPTS` unreachable and pinning the retry
rate at a flat 500ms forever. The server now sends a `{ type: "ready" }` frame once the
STT stream is actually wired up, and the client resets its ladder on *that* instead — so
this failure mode now backs off 500ms → 8s and surfaces a real error after 5 attempts
instead of flickering indefinitely.

#### Root cause A (not ours, still open): the reset itself

Something inside Railway's network resets the connection ~2ms after the `101`. Two
constraints on any explanation:

- `age=2ms` is far too fast to be the client — a round trip to a macOS browser from the
  India-South edge is ≥50ms, so the browser cannot be what closed it.
- The second `x-forwarded-for` hop differs on every reconnect (`152.233.15.120`,
  `152.233.68.98`, `152.233.15.121`, …), so the edge fleet is in the path and
  load-balanced.

The leading hypothesis is that the edge dislikes a connection that is upgraded and then
carries no traffic while the app spends its authorization window silent. The structural
fix that follows is to **authorize *before* completing the handshake**, so a `101` is
only ever sent for a connection already wired to an STT stream. Note that `server.ts`
deliberately does the opposite today, and its comment cites issue #102/#106 as the
reason — but that comment's supporting claim (that a Node `ws` client is unaffected) is
now known to be false, so the tradeoff deserves re-testing rather than being taken as
settled. **Do not change the handshake ordering without re-running the local harness
before and after**, since it is the one part of this that reproduces off Railway.

With B fixed, A degrades to what it should always have been: a transient reconnect that
either recovers or reports a clear error, instead of poisoning the process.

## Still open
### Safari / iPhone: live captions never connect

This is **not fixed**. The leading (unconfirmed) theory is the dual
`getUserMedia()` contention described in #7 above: LiveKit's own mic-publish
path calls `getUserMedia()` once, from directly inside the mic-toggle click
handler; `LiveCaptionStream`'s own capture happens moments later, from inside
a `useEffect` reacting to the resulting state change — not synchronously
inside a user gesture at all. iOS Safari is known to be considerably
stricter than desktop/Android Chrome about concurrent or non-gesture-attached
mic access.

The one attempt at fixing this (cloning LiveKit's already-open track instead
of capturing again) was reverted the same day because it broke every
browser, not just iOS — so the fix itself had a bug, not necessarily the
underlying theory. **Do not re-attempt this blind.** Before shipping a fix:

1. Reproduce reliably on a real iPhone (Safari, not just Chrome-on-iOS,
   which uses WebKit under the hood too but may behave differently) side by
   side with a real macOS Chrome session, so a fix can be verified on both
   before it goes out.
2. If retrying the clone approach, keep the auto-start effect's dependency
   list minimal and re-check whether `microphoneTrack`'s reference identity
   is actually stable across unrelated room events before depending on it —
   that's the most likely source of the reconnect-loop regression.
3. Consider, as a smaller/safer alternative, deferring `LiveCaptionStream`'s
   own `getUserMedia()` call by one tick (or until LiveKit's own publish is
   confirmed complete) rather than changing *how* the stream is acquired at
   all.

### LiveKit Cloud connectivity (Railway → LiveKit Cloud region-redirect)

Still intermittent. Railway's container network occasionally can't reach
LiveKit Cloud's region-redirect endpoint over IPv6 (`ENETUNREACH`, and
`ECONNREFUSED` on the region-lookup URL), which
`@livekit/rtc-node`'s native client doesn't fall back from to IPv4 the way
Node's own `fetch()` does. Neither the `ca-certificates` fix nor the
`/etc/gai.conf` IPv4-preference fix (both in the `Dockerfile`) resolved it.
This is why the browser-mic fallback exists at all, and why `caption-agent.ts`
capturing the facilitator is itself intermittent — when it fails to connect,
the facilitator's own browser-mic fallback picks up the slack (same pattern
as the learner side, minus the duplicate-capture risk since that path is
facilitator-only).

**This is documented, expected Railway behavior, not a mystery** (found
2026-07-28, postdating the entry above): *"Outbound IPv6 is disabled by
default"*, and while disabled *"IPv6 connection attempts fail with `Network is
unreachable` or `ENETUNREACH`"* —
[docs.railway.com/networking/outbound-networking](https://docs.railway.com/networking/outbound-networking).
Two consequences worth knowing before spending more time on this:

- **There is a toggle.** Service Settings → Networking → "Enable Outbound
  IPv6" (staged change, needs a redeploy), or
  `railway outbound-network ipv6 enable`
  ([CLI docs](https://docs.railway.com/cli/outbound-network)). Enabling it
  *"does not affect your service's existing IPv4 outbound connectivity."*
  Caveat: a [community report](https://station.railway.com/questions/i-pv6-feature-flag-can-t-connect-to-sup-38b41ca1)
  says IPv6 routing still failed to reach some hosts even with the flag on, so
  staying IPv4-only and stopping the native client from attempting AAAA at all
  is the more reliable direction.
- **Why `/etc/gai.conf` didn't work:** it only reorders `getaddrinfo` results.
  Rust clients that call `to_socket_addrs` and iterate, or that use their own
  resolver, routinely ignore glibc `precedence` rules. Railway documents **no**
  env var for forcing IPv4 (`NODE_OPTIONS`, `--dns-result-order`,
  `autoSelectFamily` — all absent from their docs); the toggle is the only
  documented control.

**The deeper issue is architectural.** LiveKit documents agent workers as a
*dedicated deployment*, and embedding one in the Next.js server process fights
four documented assumptions: the default `load_fnc` is **host CPU** with a 0.7
threshold (so Next.js request traffic makes the worker refuse jobs), agents want
a **10+ minute** SIGTERM drain while a web server wants seconds (every deploy
either kills live sessions or stalls the rollout), the two scale on opposite
axes, and a crash in either takes out both. It also silently binds :8081 for its
own health check. See
[docs.livekit.io/deploy/custom/deployments](https://docs.livekit.io/deploy/custom/deployments)
and [agent server options](https://docs.livekit.io/agents/server/options).

The supported fixes, in increasing order of effort:

1. **Split the worker into its own Railway service.** This also deletes
   `@livekit/rtc-node` from the `web` image, making the IPv6 question moot for
   the service that actually serves users.
2. **LiveKit Cloud Agents** (`lk agent create` / `lk agent deploy`) — GA, Node
   is first-class with an official Dockerfile template, and rolling deploys
   drain active sessions for up to an hour, which Railway can't do.
   [docs.livekit.io/deploy/agents](https://docs.livekit.io/deploy/agents).
   ~$0.01/agent-session-minute.

**Worth knowing:** there is **no** hosted, agent-less server-side transcription
— every LiveKit transcription path runs through an agent you own (LiveKit
Inference is a hosted *model gateway*, not a transcription service). But caption
*delivery* is first-class and this app is reinventing it: `AgentSession`
publishes to the `lk.transcription` text-stream topic **by default**, consumed
client-side with `useTranscriptions()`. The custom DataChannel push is a second,
redundant path. Persisting to Postgres, on the other hand, is legitimately the
app's job — LiveKit explicitly does not persist text streams, and late joiners
receive nothing of a stream already in progress, so app-side backfill is
required. See
[text & transcriptions](https://docs.livekit.io/agents/multimodality/text) and
[text streams](https://docs.livekit.io/transport/data/text-streams).
