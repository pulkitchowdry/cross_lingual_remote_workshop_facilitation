# src/ — conventions for the Next.js app

Read the root `README.md`'s "Server-only provider interfaces" section first.
This file is about *how* to extend the app consistently with what's already
there — see the root `AGENTS.md` for the Next.js-version warning that applies
to everything under here too.

## The provider pattern is the main architectural rule here

`src/lib/providers/*.ts` each define a typed interface (`RoomProvider`,
`TranslationProvider`, `SpeechToTextProvider`, `InsightProvider`,
`TextToSpeechProvider`) with a single concrete implementation behind it and a
mock/no-op fallback when the corresponding API key isn't configured. **Application
code (routes, components) should depend on these interfaces, never on a
vendor SDK directly.** If you're adding a call to Claude, Deepgram, ElevenLabs,
LiveKit, or `local-inference`, it almost certainly belongs as a method on one
of these providers (or a new provider following the same shape), not as an
inline `fetch`/SDK call in a route handler. This is what lets every feature
"degrade gracefully" (per the README) instead of crashing when a key is
missing — each provider's `isConfigured` gate encodes that.

`local-inference` is a fallback *tier* inside `TranslationProvider`/
`SpeechToTextProvider`/`TextToSpeechProvider`, not a separate provider
interface — see `local-inference-client.ts` and
`docs/TRANSLATION_ARCHITECTURE.md` Part 5 for the try-local-then-cloud
fallback order and how `TranslationMode.LOCAL_ONLY` disables that fallback.

## Environment variables

`src/lib/env.ts`'s `ENV_SPEC` is the single source of truth for which env
vars are required vs. optional. Adding a new provider key: add it there
(`required: false` unless the whole app should fail to boot without it, which
today only `DATABASE_URL` does), then to `.env.example` at the repo root, then
wire it into `docker-compose.yml` and `docs/DEPLOYMENT.md` if it needs to
reach a Docker/Railway deployment — see the root `SKILLS.md`'s "Add a new
environment variable".

## Database

Prisma client generator output is custom: `prisma/schema.prisma`'s `output`
points at `src/generated/prisma` (gitignored — regenerate with
`npm run db:generate` after clone/pull or schema changes). The app uses
Prisma's **driver adapter** mode (`@prisma/adapter-pg` + `pg`, see
`src/lib/db.ts`), not the classic Rust query engine — there's no
`binaryTargets`/OpenSSL-matching concern to worry about when changing how
this gets built or containerized.

## Testing

Vitest, colocated `*.test.ts` next to the module they test (see
`vitest.config.ts`'s `include`). Run with `npm test` /`npm run test:watch`.
New logic in `src/lib/` (especially providers) should get a colocated test
following the existing pattern — mock the vendor SDK/`fetch`, not the
provider interface itself, so the test still exercises the real
`isConfigured`/fallback logic.

Playwright e2e (`npm run test:e2e`, `e2e/*.spec.ts`) starts its own dev server
against `DATABASE_URL` — needs a reachable Postgres, doesn't mock the
database.

See root README's "Testing" section for the one documented gap: the raw
WebSocket mic-streaming path (`/api/captions/stream`) can't be exercised under
plain `next dev`/Playwright, only under real Vercel Fluid Compute.
