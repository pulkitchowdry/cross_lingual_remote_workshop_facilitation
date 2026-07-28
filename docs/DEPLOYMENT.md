# Deployment

This app is three independently-deployable pieces (see the root README's Architecture
section and `local-inference/README.md` for *why* it's still split out):

| Service | Directory | What it is |
| --- | --- | --- |
| `web` | `/` | The Next.js app — also runs the LiveKit caption agent worker (`src/lib/caption-agent.ts`) in-process; see `docs/TRANSLATION_ARCHITECTURE.md` Part 2 |
| `local-inference` | `local-inference/` | Self-hosted NLLB/faster-whisper/Piper FastAPI service |
| PostgreSQL | — | Session/message storage |

(`agent/` used to be a fourth, separately-deployed piece — a standalone LiveKit
Agents worker with its own `package.json`. It was folded into `web` since this
is a hackathon project, not a long-term production system, and the extra
service/lockfile/HTTP boundary wasn't worth the operational overhead. See
`docs/TRANSLATION_ARCHITECTURE.md` Part 2 for the full history.)

Note that the LiveKit **server** is not one of these: it's LiveKit Cloud, and browsers
connect to it directly without passing through Railway. That distinction matters when
debugging captions — see `docs/CAPTION_TRANSPORT_HOSTING_DECISION.md` for what is hosted
where, and why "move LiveKit off Railway" is not an available action.

Everything except `DATABASE_URL` is optional at runtime (`src/lib/env.ts` — features
fall back to mock/cloud providers until their key is set), so none of the steps below
are all-or-nothing.

## Running the whole stack locally with Docker Compose

This is the one-command path — it builds and wires up Postgres, a local LiveKit
dev server, `local-inference`, and `web` together:

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
  database: `docker compose up postgres web`. `local-inference` and `livekit`
  are independent — the app runs (with those features degraded) without them.
- **`.env` vs `.env.local`:** Next.js loads both; Docker Compose's `${VAR}`
  substitution only reads `.env`. Keeping secrets in `.env` means one file
  works for `npm run dev` and `docker compose up` alike.
- `LIVEKIT_URL`/`LIVEKIT_AGENT_URL` are deliberately different values on
  `web` in `docker-compose.yml` — see the comment at the top of that file. If
  you add a new client-facing use of a Compose-internal service, check
  whether the same distinction applies before wiring it up.
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
This repo follows that shape for its two Railway services — `railway.json`
(root, for `web`) and `local-inference/railway.json`.

1. **Create a project, add a PostgreSQL database.** In the Railway dashboard:
   New Project → Database → PostgreSQL. Use the managed plugin, not a
   containerized Postgres — Railway's guidance is to prefer it for backups/
   scaling, and it gives you a `DATABASE_URL` reference variable for free.

2. **Create a LiveKit Cloud project** — Railway cannot host `livekit-server`
   itself as a Railway service. LiveKit's WebRTC media transport needs a wide
   UDP port range for ICE/TURN (see `docker-compose.yml`'s local-only
   `livekit` service for what that looks like); Railway's public networking
   is HTTP(S)/TCP-only and can't expose that. Use a real external LiveKit
   deployment instead:
   - Sign up at [cloud.livekit.io](https://cloud.livekit.io) and create a
     project (the free tier is enough for this app's scope).
   - Note the **Project URL** (`wss://your-project-xxxx.livekit.cloud`) and,
     under Settings → Keys, an **API Key** + **API Secret** (create a new key
     pair if none exists).
   - These three values are what `LIVEKIT_URL`/`LIVEKIT_API_KEY`/
     `LIVEKIT_API_SECRET` below need to be set to — `LIVEKIT_URL` is the
     `wss://...` project URL, not an `http://` one.

3. **Add the `web` service.** New → GitHub Repo → this repo. In its Settings:
   - Root Directory: `/` (default)
   - Config-as-code path: `/railway.json`
   - Variables: `DATABASE_URL` = a **reference variable** to the Postgres
     plugin (`${{Postgres.DATABASE_URL}}`), `LIVEKIT_URL`/`LIVEKIT_API_KEY`/
     `LIVEKIT_API_SECRET` from step 2, plus whichever of
     `CLAUDE_API_KEY`/`CLAUDE_API_URL`, `STT_API_KEY`, `TTS_API_KEY`,
     `INSIGHT_MODEL_API_KEY`, `CRON_SECRET` you have (see `.env.example` for
     what each does). `LIVEKIT_AGENT_URL` is Docker-Compose-only (Railway has
     no equivalent host/container split) — leave it unset so the in-process
     caption agent worker just uses `LIVEKIT_URL`. Generate
     `LOCAL_INFERENCE_SECRET` as a random string — it must match the value
     you set on `local-inference` below.
   - Networking: generate a public domain so the app is reachable.
   - **Set `NEXT_PUBLIC_APP_URL` to that public domain** (e.g.
     `https://your-app.up.railway.app`) once you have it. The facilitator
     dashboard builds the learner invite link/QR code from this — leaving it
     unset silently falls back to `http://localhost:3000`, so every learner
     link you hand out from a deployed instance would point at localhost
     instead of this deployment.

4. **Add the `local-inference` service** (skip if you're staying on cloud
   providers only — see `local-inference/README.md` for full detail on
   everything in this step, including a real failure mode and its fix).
   New → GitHub Repo → same repo.
   - Root Directory: `/local-inference`
   - Config-as-code path: `/local-inference/railway.json`
   - **Budget at least 2GB of memory for this service once it's actually
     serving traffic** (Settings → Resources, or similar — exact location
     depends on your Railway plan). `/health` only reports whether each
     model singleton has already been constructed, so a fresh deploy passes
     its healthcheck without loading anything — but NLLB, faster-whisper,
     and the Piper voices (~1.5GB combined) each still lazily load into
     memory on their first real request and never unload, so a deploy that
     actually serves translate + STT + TTS traffic still needs that combined
     footprint. On a plan hard-capped below ~2GB, the visible symptom is the
     service booting and passing its healthcheck successfully, then getting
     silently OOM-killed (logged as plain `Killed`, not an error) once
     traffic has touched all three capabilities — not a code bug, and the
     `None of PyTorch, TensorFlow >= 2.0, or Flax have been found` line in
     the same logs is unrelated, expected noise (this service uses
     `ctranslate2`, not PyTorch, for inference). If the plan can't go above
     1GB, either drop one of the three capabilities from this service or
     leave its route unset so `web` falls back to a cloud provider for it
     instead (`src/lib/env.ts`).
   - Variables: `LOCAL_INFERENCE_SECRET` (any random string).
   - On `web`, set two variables to reach this service over Railway's
     private network (no public URL, and no separate "connect this to that"
     step needed — any two services in the same Railway project can already
     reference each other's variables):
     - `LOCAL_INFERENCE_URL=http://${{local-inference.RAILWAY_PRIVATE_DOMAIN}}:8080`
       (replace `local-inference` with your actual Railway service name if
       you named it differently)
     - `LOCAL_INFERENCE_SECRET=${{local-inference.LOCAL_INFERENCE_SECRET}}`
       (references the value you set two bullets up, so it can't drift)
   - This service does not need — and should not have — a connection to
     Postgres or anything else; it has no database access at all.

5. **Confirm each deploy's healthcheck/logs** — `web`'s `railway.json` checks
   `/`, `local-inference`'s checks `/health`. Watch `web`'s deploy logs for
   the LiveKit Agents worker registering successfully too (it logs a warning
   and no-ops instead if `LIVEKIT_URL`/`LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`/
   `STT_API_KEY` aren't all set).

Once this is wired up once, Railway's dashboard lets you export the whole
project as a **Template** — that's the mechanism for turning this into an
actual one-click "Deploy on Railway" button (for yourself or to share).
That's a one-time interactive step in the dashboard, not something a config
file can do on its own.

### Env var reference

See `.env.example` at the repo root and the "Environment variables" table in
`local-inference/README.md` for the full, authoritative list — this doc only
covers how those variables get wired *between* Railway services, not what
each one does.
