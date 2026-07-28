# Dub-audio track migration (2026-07-28)

Replaces the live in-meeting translated-audio pipeline with real LiveKit audio
tracks, published from the existing `caption-agent.ts` worker. Complements
`docs/TRANSLATION_ARCHITECTURE.md` Part 3 (that section's original design is
what this ships, with one adjustment — see "Why not a bot per language"
below) and `docs/CAPTION_AUDIO_TROUBLESHOOTING.md` (the bug history that
motivated this).

## Problem

The old live-meeting pipeline was two unsynchronized systems glued together
with client-side bookkeeping:

- **`TranslatedAudioPlayer.tsx`** — for every learner's browser, independently:
  fetch synthesized MP3 for every new caption segment from
  `/api/captions/[segmentId]/audio`, hand-queue it behind whatever was already
  playing so overlapping captions don't talk over each other, retry on
  autoplay-block, etc.
- **`DuckedRoomAudio.tsx`** — separately mutes the *original* speaker's raw
  LiveKit mic track to near-zero volume (`0.0001`, not literal `0` — a
  `livekit-client` bug treats `0` as falsy and skips reapplying it on
  reattach) for any listener whose language differs, so the dub and the raw
  speech don't play simultaneously.

Neither system knows about the other beyond "assume the other one is doing
its job." This was the direct or indirect cause of several bugs already
chased in `docs/CAPTION_AUDIO_TROUBLESHOOTING.md`: the falsy-zero ducking bug
(#2), silent-TTS-with-no-explanation (#4), and the reconnect-loop regression
(#7). It was also always a deliberate scope cut, not an oversight — see
"Why not a bot per language" below for why it wasn't built this way from the
start.

## What changed

`src/lib/caption-agent.ts` (the LiveKit Agents worker that already subscribes
to the facilitator's mic track and runs it through STT) now **also publishes
one real LiveKit audio track per target language** — `dub-en`, `dub-zh`,
`dub-es` — from that same already-connected room session. On every finalized,
translated caption segment, the synthesized speech for each target language
(other than whatever language the facilitator is currently speaking) is fed
onto that language's track. A listener's browser (`DubAudioPlayer.tsx`) just
subscribes to whichever track matches their own `preferredLanguage`, the same
way it would subscribe to any other participant's audio — LiveKit's own
subscription/playback machinery handles the rest, no client-side queue needed.

**Scope: facilitator speech only, this iteration.** Learner speech has no
LiveKit-side track capture today — only the separate browser-mic WebSocket
fallback (`captions-socket.ts`/`LiveCaptionStream.tsx`) — so dubbing a
learner's speech into other languages/audio is a natural follow-on, not
addressed here.

**Not touched:** the post-session transcript **recap** replay
(`facilitator/page.tsx`/`learn/page.tsx`, only inside their
`SessionStatus.ENDED` branch) still uses the original `TranslatedAudioPlayer`
+ `/api/captions/[segmentId]/audio` — there's no live LiveKit room once a
session has ended, so there's nothing to publish a track into. See that
component's updated doc comment.

## Why not a bot per language

`docs/TRANSLATION_ARCHITECTURE.md`'s original design (never built, until now)
was a separate `interpreter-<lang>` bot participant per target language, each
publishing its own track. That would mean **N additional LiveKit Cloud room
connections** (one per language, on top of `caption-agent.ts`'s own). This
deployment has a documented, unresolved intermittent LiveKit Cloud
connectivity failure (`ECONNREFUSED`/`ENETUNREACH` on `ctx.connect()`, see
`docs/CAPTION_AUDIO_TROUBLESHOOTING.md`'s "Still open" section) — adding more
required connections multiplies exposure to that flakiness instead of
reducing it. Publishing multiple tracks from the **one** worker connection
`caption-agent.ts` already has gets the same listener-facing result (one
subscribable track per language) without that cost.

## Implementation

- **`src/lib/providers/text-to-speech.ts`** — `synthesizeWithElevenLabs` now
  requests `output_format=pcm_<rate>` (a query param) instead of MP3
  (`Accept: audio/mpeg`) — this app has no MP3 decoder anywhere, and feeding a
  LiveKit `AudioSource` needs raw 16-bit PCM. The raw PCM is immediately
  wrapped back into a minimal WAV container (`wrapPcmAsWav`) before being
  returned, so `SynthesizedSpeech.audio` stays one uniform, self-describing
  format regardless of tier — Piper's tier was already a real WAV file. This
  matters because the same `synthesize()` result also feeds the recap HTTP
  route above, which streams bytes straight to a browser `<audio>` tag;
  headerless raw PCM isn't playable there.
- **`toPcmSamples(audio)`** (same file) — walks a WAV/RIFF container's chunks
  to find `fmt ` (sample rate/channels) and `data` (the PCM payload).
  Deliberately not a hardcoded 44-byte offset: Python's stdlib `wave` module
  (what Piper's tier writes through) is free to emit extra chunks before
  `data`, and chunks are word-aligned (odd-sized chunks get a padding byte).
- **`src/lib/captions.ts`** — `publishTranslatedCaption` now returns
  `{ segmentId, sourceLanguage, translations }` instead of nothing, so a
  caller can drive further work (dub synthesis) off the same translation
  results without a second translate call. Purely additive; the existing
  WebSocket caller (`captions-socket.ts`) already discarded the return value.
- **`src/lib/providers/dub-audio-publisher.ts`** (new) — for every
  `SUPPORTED_LANGUAGES` entry, eagerly (at connect time, not lazily on first
  use) creates an `AudioSource`/`LocalAudioTrack.createAudioTrack("dub-<lang>",
  ...)` and publishes it via `room.localParticipant.publishTrack(...)`. Eager
  publish avoids a race where a learner in that language joins/subscribes
  before the facilitator has said anything needing translation into it.
  `enqueue(language, text, allowCloudFallback)` synthesizes and
  `captureFrame()`s onto that language's track, queued strictly FIFO **per
  language** (a `Promise` chain) so two facilitator segments dubbed into the
  same language never overlap on the shared track — different languages'
  queues run fully in parallel. Bounded to 5 pending segments per language;
  past that, a new segment is dropped (logged, not thrown) rather than
  building an ever-growing backlog — captions/translations are already
  persisted independently of this, so a dropped dub is a latency concern, not
  a correctness one. `@livekit/rtc-node`'s `TrackPublishOptions` has no
  metadata/attributes field, so a track's own `name` is the only
  per-language discriminator available to a client.
  Resamples via `@livekit/rtc-node`'s own `AudioResampler` when a tier's
  actual rate doesn't match the track's configured rate (matched to Piper's
  actual output rate as the common case, since it's the primary/default
  tier — only the rarer ElevenLabs fallback typically needs resampling).
- **`src/lib/caption-agent.ts`** — creates the publisher once per job, right
  after `ctx.connect()` resolves (never allowed to take down the worker if it
  fails — captions must keep working even if track-publishing itself can't).
  After each segment's `publishTranslatedCaption` call, enqueues a dub for
  every returned translation except the language just spoken. Closed via the
  existing `ctx.addShutdownCallback`.
- **`src/components/meeting/DubAudioPlayer.tsx`** (new) — `useTracks` for
  `Track.Source.Unknown` (every published track uses this source: LiveKit's
  `TrackSource` enum has no custom value to mark "this is a dub track"),
  filtered to whichever publication's `trackName === "dub-<myLanguage>"`.
  Renders one `<AudioTrack volume={1}>` when found, nothing otherwise.
  Rendered once, inside `LiveSessionRoom.tsx`, alongside the existing
  `DuckedRoomAudio` — no conflict between the two: `DuckedRoomAudio` already
  filters its own tracks down to `facilitator:`/`learner:`-prefixed
  identities, so it never picks up the bot's tracks (a different identity)
  in the first place.

## Verification

`npx tsc --noEmit` and `npm test -- --run` (270 tests, including new coverage
for `toPcmSamples`'s WAV-chunk-walking and `dub-audio-publisher.ts`'s
per-language FIFO ordering/queue-depth-cap/resampling behavior) — both clean.

This repo's own documented testing gap (`src/AGENTS.md`) is that the raw
real-time paths can't be exercised under plain `next dev`/Playwright — this
applies equally to real LiveKit track publish/subscribe. Verify end-to-end on
the actual deployment: facilitator speaks, confirm (a) captions still appear
as before, (b) a learner in a different language hears the dub via a real
subscribed track rather than a fetched `<audio src>`, (c) the `dub-<lang>`
tracks appear published once at session start (LiveKit's room inspector or
equivalent), not per-segment.
