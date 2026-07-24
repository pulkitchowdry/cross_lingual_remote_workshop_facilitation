# Live-caption agent worker

A standalone [LiveKit Agents](https://docs.livekit.io/agents/) worker that subscribes to the
facilitator's audio track **server-side**, so captions work without the facilitator opening the
mic control in their browser. This is the "server-side track subscription" item from
`docs/TRANSLATION_ARCHITECTURE.md` Part 2.

## Why this is a separate package

This worker needs a **persistent, long-running process** — it registers with LiveKit's server and
stays connected, waiting to be dispatched into rooms. That doesn't fit Vercel Functions (the main
app's deployment target), which are request-scoped. So it:

- Lives in its own `agent/` directory with its own `package.json`/`node_modules`, keeping
  `@livekit/agents` (an 18MB+ dependency tree with native/ffmpeg bits) out of the Next.js app's
  install and deploy bundle.
- Talks to the Next.js app over HTTP (`/api/captions/agent`), authenticated with a shared secret
  (`CAPTION_AGENT_SECRET`), instead of importing `@/lib/db`/`@/lib/captions` directly. An earlier
  version of this worker tried the direct import — it failed in testing: the generated Prisma
  client's `export * from "./enums"` doesn't propagate through `tsx`/esbuild's module resolution
  the way it does through Next's own bundler, so `SessionStatus` came back `undefined` outside of
  Next. The HTTP boundary sidesteps that and keeps this worker's only dependency on the rest of the
  codebase down to the STT provider (`../src/lib/providers/speech-to-text.ts`), which has no Prisma
  import and resolves fine under `tsx`.
- Reuses that same `SpeechToTextProvider.openStream` boundary the browser mic path
  (`LiveCaptionStream`/`/api/captions/stream`) uses, so both capture paths go through one Deepgram
  integration.

You need to deploy this somewhere that supports a persistent process — a small VM, Fly.io,
Railway, a container platform, etc. Which one is an explicit infrastructure decision this repo
hasn't made yet; nothing here assumes a specific host.

## Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `LIVEKIT_URL` | Yes | Same LiveKit project as the Next.js app |
| `LIVEKIT_API_KEY` | Yes | |
| `LIVEKIT_API_SECRET` | Yes | |
| `STT_API_KEY` | Yes | Deepgram key — this worker only runs the streaming path |
| `APP_BASE_URL` | Yes | Base URL of the running Next.js app, e.g. `http://localhost:3000` |
| `CAPTION_AGENT_SECRET` | Yes | Must match the Next.js app's `CAPTION_AGENT_SECRET` |

## Running locally

```sh
cd agent
npm install
cp ../.env.example .env   # fill in the variables above
npm run dev
```

LiveKit's Agents CLI (`dev`/`start`) registers the worker and waits for job dispatch — it will pick
up any room named `workshop-<sessionId>` and start listening once a `facilitator:*` participant's
audio track is published, exactly matching the identity scheme `RoomProvider.issueCredential` uses.

**Not verified end-to-end in this environment** — no `LIVEKIT_URL`/`STT_API_KEY`/LiveKit Cloud
project was available to actually run a session through this worker. Before deploying, verify: the
`AutoSubscribe.AUDIO_ONLY` connect actually yields a `trackSubscribed` event for the facilitator's
track, the 16kHz mono PCM resampling `AudioStream(track, 16_000, 1)` requests matches what Deepgram
expects for `encoding=linear16&sample_rate=16000&channels=1`, and that `/api/captions/agent`
correctly authenticates and publishes.
