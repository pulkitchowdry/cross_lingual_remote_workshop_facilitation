# Skills: common cross-cutting tasks

Task recipes that touch more than one package. Package-local tasks (adding a
route, adding a provider, adding an inference model) live in each package's
own `SKILLS.md` — see the table in [`AGENTS.md`](AGENTS.md).

## Add a new environment variable

1. Add it to `.env.example` at the repo root, with a comment explaining what
   it does and whether it's required — this file is the single source of
   truth other docs point back to.
2. If the app should fail fast when it's missing (vs. degrading gracefully),
   add it to `ENV_SPEC` in `src/lib/env.ts`.
3. Wire it into `docker-compose.yml` (`web`'s `environment:` block,
   `${VAR:-default}` form so `docker compose up` still works with no `.env`)
   and into the relevant section of `docs/DEPLOYMENT.md` if it needs wiring
   between Railway services.

## Add a new Docker Compose service

1. Add a `services:` entry to `docker-compose.yml`. If it's built from this
   repo (not a pre-built image), give it its own `Dockerfile` in its own
   directory — each package builds independently, see `.dockerignore` at the
   repo root for why (`web`'s build context deliberately excludes
   `local-inference/`).
2. Decide whether values you hand it are browser-reachable or
   container-only — see the `LIVEKIT_URL` comment at the top of
   `docker-compose.yml` for why this distinction matters and has bitten this
   repo before. Anything returned to the browser (a token response, a
   redirect) needs a host-reachable URL (`localhost:<port>`); anything called
   server-to-server can use the Compose-internal service hostname.
3. If it should also deploy to Railway, add a `railway.json` in that
   directory (`{"build": {"builder": "DOCKERFILE", "dockerfilePath":
   "Dockerfile"}, ...}` — copy the shape from `local-inference/railway.json`)
   and document the new service in `docs/DEPLOYMENT.md`'s Railway section.

## Run database migrations

- Locally (native): `npx prisma migrate dev` (creates + applies a new
  migration) or `npx prisma migrate deploy` (applies existing migrations only,
  no schema-drift prompts).
- Locally (Docker Compose): automatic — `docker-entrypoint.sh` runs `prisma
  migrate deploy` before `web` starts, every boot.
- After changing `prisma/schema.prisma`: `npx prisma migrate dev --name
  <description>` to generate the migration, then `npx prisma generate` to
  regenerate the client at `src/generated/prisma` (gitignored, must be
  regenerated after clone/pull too — `npm run db:generate`).

## Deploy

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — Docker Compose for local, or
Railway (one Railway service per package, each with its own `railway.json`)
for hosting. The Next.js app also still deploys to Vercel as before (see
`vercel.json`'s cron config for `/api/retention/cleanup`) — Railway is an
addition, not a replacement, and is the only option for `local-inference/`
since it needs a persistent process Vercel Functions can't provide (see that
package's own README for why). `web` also needs a persistent process for its
own custom `server.ts` (WebSocket upgrades, the in-process LiveKit caption
agent worker) — that's true on Railway regardless of `local-inference/`.
