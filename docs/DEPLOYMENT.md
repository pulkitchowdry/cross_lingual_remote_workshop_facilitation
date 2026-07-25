# Deployment

This app is four independently-deployable pieces (see the root README's Architecture
section and each package's own README for *why* they're split up):

| Service | Directory | What it is |
| --- | --- | --- |
| `web` | `/` | The Next.js app |
| `agent` | `agent/` | Standalone LiveKit Agents worker (server-side captions) |
| `local-inference` | `local-inference/` | Self-hosted NLLB/faster-whisper/Piper FastAPI service |
| PostgreSQL | — | Session/message storage |

Everything except `DATABASE_URL` is optional at runtime (`src/lib/env.ts` — features
fall back to mock/cloud providers until their key is set), so none of the steps below
are all-or-nothing.

## Running the whole stack locally with Docker Compose

This is the one-command path — it builds and wires up Postgres, a local LiveKit
dev server, `local-inference`, `web`, and `agent` together:

```sh
cp .env.example .env   # fill in any real keys you have — everything else degrades gracefully
docker compose up --build
```

Then open [http://localhost:3000](http://localhost:3000).

Notes:

- **First build is slow.** `local-inference` bakes ~1-1.5GB of model weights into
  its image at build time (see `local-inference/README.md`) so the first
  `docker compose up --build` can take several minutes; later builds are cached.
- **Migrations run automatically.** `docker-entrypoint.sh` runs `prisma migrate
  deploy` before the `web` container starts `next start`, every boot — it's a
  no-op once the schema is current, so this is safe on restarts too.
- **Don't need everything?** Start a subset, e.g. just the app plus its
  database: `docker compose up postgres web`. `local-inference`, `livekit`,
  and `agent` are independent — the app runs (with those features degraded)
  without them.
- **`.env` vs `.env.local`:** Next.js loads both; Docker Compose's `${VAR}`
  substitution only reads `.env`. Keeping secrets in `.env` means one file
  works for `npm run dev` and `docker compose up` alike.
- `LIVEKIT_URL` is deliberately different for `web` and `agent` in
  `docker-compose.yml` — see the comment at the top of that file. If you add a
  new client-facing use of a Compose-internal service, check whether the same
  distinction applies before wiring it up.
- **Port 5432 already taken on your machine?** (e.g. by a native Postgres
  install, per this README's "Option B" setup) — set `POSTGRES_PORT` in your
  `.env` to a free port instead. Change only that; don't touch the `5432` on
  the right of `postgres`'s `ports:` mapping or `web`'s `DATABASE_URL`.
  Compose's `ports: "HOST:CONTAINER"` only remaps the *host* side — Postgres
  always listens on 5432 *inside* its own container regardless, and
  container-to-container traffic (`web` → `postgres`) goes over the internal
  Compose network directly to that real port, never through the published
  host port. `POSTGRES_PORT` only matters for reaching the container from
  your host (`psql`, a native `npm run dev` pointed at this same container).

## Deploying to Railway

Railway does not run a repo's `docker-compose.yml` directly — each service in
a monorepo is a separate Railway service pointed at a subdirectory, each with
its own `railway.json` ([Railway monorepo docs](https://docs.railway.com/deployments/monorepo)).
This repo already follows that shape — `railway.json` (root, for `web`),
`agent/railway.json`, and `local-inference/railway.json` are the three
per-service configs.

1. **Create a project, add a PostgreSQL database.** In the Railway dashboard:
   New Project → Database → PostgreSQL. Use the managed plugin, not a
   containerized Postgres — Railway's guidance is to prefer it for backups/
   scaling, and it gives you a `DATABASE_URL` reference variable for free.

2. **Add the `web` service.** New → GitHub Repo → this repo. In its Settings:
   - Root Directory: `/` (default)
   - Config-as-code path: `/railway.json` (Railway resolves config paths from
     the repo root regardless of the service's Root Directory, so this is an
     absolute path even though `railway.json` lives at the repo root)
   - Variables: `DATABASE_URL` = a **reference variable** to the Postgres
     plugin (`${{Postgres.DATABASE_URL}}`), plus whichever of
     `LIVEKIT_URL`/`LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`,
     `CLAUDE_API_KEY`/`CLAUDE_API_URL`, `STT_API_KEY`, `TTS_API_KEY`,
     `INSIGHT_MODEL_API_KEY`, `CRON_SECRET` you have (see `.env.example` for
     what each does). Generate `CAPTION_AGENT_SECRET` and
     `LOCAL_INFERENCE_SECRET` as random strings — they must match the values
     you set on `agent` and `local-inference` below.
   - Networking: generate a public domain so the app is reachable.

3. **Add the `local-inference` service** (skip if you're staying on cloud
   providers only). New → GitHub Repo → same repo.
   - Root Directory: `/local-inference`
   - Config-as-code path: `/local-inference/railway.json`
   - Variables: `LOCAL_INFERENCE_SECRET` (same value as `web`'s)
   - On `web`, set `LOCAL_INFERENCE_URL` to this service's private network
     URL (Railway private networking, `http://<service>.railway.internal:8080`,
     or the reference-variable equivalent) so the call stays off the public
     internet.

4. **Add the `agent` service** (skip if you're not running server-side
   captions). New → GitHub Repo → same repo.
   - Root Directory: `/agent`
   - Config-as-code path: `/agent/railway.json`
   - Variables: `LIVEKIT_URL`/`LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` (same
     LiveKit project as `web`), `STT_API_KEY`, `CAPTION_AGENT_SECRET` (same
     value as `web`'s), and `APP_BASE_URL` set to `web`'s public domain.

5. **Confirm each deploy's healthcheck/logs** before moving to the next
   service — `web`'s `railway.json` checks `/`, `local-inference`'s checks
   `/health`. `agent` has no HTTP healthcheck (it's a worker, not a server);
   watch its deploy logs for the LiveKit Agents worker registering
   successfully instead.

Once this is wired up once, Railway's dashboard lets you export the whole
project as a **Template** — that's the mechanism for turning this into an
actual one-click "Deploy on Railway" button (for yourself or to share).
That's a one-time interactive step in the dashboard, not something a config
file can do on its own.

### Env var reference

See `.env.example` at the repo root and the "Environment variables" tables in
`agent/README.md` and `local-inference/README.md` for the full, authoritative
list — this doc only covers how those variables get wired *between* Railway
services, not what each one does.
