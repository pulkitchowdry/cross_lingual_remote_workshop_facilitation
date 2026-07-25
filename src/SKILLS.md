# Skills: src/ (Next.js app) tasks

See [`AGENTS.md`](AGENTS.md) first for the provider pattern this assumes.

## Add a new server-side capability backed by an external API

1. Add a typed interface + implementation in `src/lib/providers/` following
   the shape of an existing one (e.g. `text-to-speech.ts` for a
   single-call-in/out provider, `speech-to-text.ts` for one with a streaming
   variant too). Gate the real implementation behind `isConfigured`, and
   provide a mock/no-op fallback.
2. If it should try a self-hosted `local-inference` route before falling back
   to the cloud vendor, look at how `translation.ts`/`speech-to-text.ts`
   already call `local-inference-client.ts` first.
3. Add the new env var(s) to `src/lib/env.ts`'s `ENV_SPEC`, `.env.example`,
   and `docker-compose.yml` (see root `SKILLS.md`).
4. Add a colocated `*.test.ts` mocking the vendor call, not the provider
   interface.
5. Call the provider from a route handler or component — never the vendor
   SDK directly (see `AGENTS.md`).

## Add a new API route

Standard Next.js App Router convention: `src/app/api/<path>/route.ts`. Check
`src/lib/session-security.ts` if the route needs facilitator/learner auth —
it's the shared opaque cookie/token boundary both roles already use (see root
README's Tech Stack note on Clerk migration being decided-but-not-yet-done
for the facilitator side specifically).

## Run migrations / regenerate the Prisma client

```sh
npx prisma migrate dev --name <description>   # after changing schema.prisma
npm run db:generate                            # regenerate src/generated/prisma
```

See root `SKILLS.md`'s "Run database migrations" for the Docker Compose
equivalent (automatic, via `docker-entrypoint.sh`).

## Run the app

- Native: `npm run dev` (needs Postgres reachable via `DATABASE_URL` at
  minimum; see root README's "Getting Started" for LiveKit/Deepgram/Claude).
- Docker Compose (whole stack): `docker compose up --build` from the repo
  root — see `docs/DEPLOYMENT.md`.

## Run tests

`npm test` (Vitest, unit), `npm run test:e2e` (Playwright, needs a reachable
Postgres). See `AGENTS.md`'s "Testing" for the one path that can't be
exercised this way.
