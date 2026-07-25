# Skills: agent/ worker tasks

See [`AGENTS.md`](AGENTS.md) first — this worker shares code with the main
app in a way that isn't obvious from `agent/package.json` alone.

## Run it locally

```sh
cd agent
npm install
cp ../.env.example .env   # fill in LIVEKIT_*, STT_API_KEY, APP_BASE_URL, CAPTION_AGENT_SECRET
npm run dev
```

Requires the main app already running (for `/api/captions/agent`) and a
reachable LiveKit server — see `agent/README.md`'s env var table.

## Run it via Docker Compose

Part of the root `docker-compose.yml`'s default stack — `docker compose up`
builds and starts it alongside `web` and `livekit`. No separate steps needed;
see `docs/DEPLOYMENT.md`.

## Change what the worker captures or how it publishes captions

- Track subscription / room-join logic: `defineAgent`'s `entry` function in
  `worker.ts`.
- Audio streaming to STT: `streamFacilitatorAudio` — this reuses
  `speechToTextProvider.openStream` from `src/lib/providers/speech-to-text.ts`.
  Changes to the streaming contract belong there, not duplicated here (see
  `AGENTS.md`).
- What gets sent back to the app: `CaptionAgentClient` in `worker.ts`, calling
  `/api/captions/agent` (route lives in the main app's `src/app/api/`).

## Add a new required environment variable

Use `requireEnv(name)` (already in `worker.ts`) so a missing var fails fast
with a clear message instead of a null-pointer deeper in the worker. Then:
document it in `agent/README.md`'s env var table, add it to
`docker-compose.yml`'s `agent` service, and to `docs/DEPLOYMENT.md`'s Railway
`agent` service section.

## Deploy

Railway, via `agent/railway.json` — see `docs/DEPLOYMENT.md`. This worker
needs a persistent process (it registers with LiveKit and waits for job
dispatch), so it cannot run on Vercel Functions — see `agent/README.md`'s
"Why this is a separate package".
