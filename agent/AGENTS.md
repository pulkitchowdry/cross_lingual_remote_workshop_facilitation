# agent/ — conventions for this worker

Read `agent/README.md` first for *why* this package exists and its
not-verified-end-to-end caveats. This file is about *how* to change it
without breaking the things that aren't obvious from the code.

## This package is not as isolated as it looks

`agent/package.json` only lists `@livekit/agents` and `dotenv` as
dependencies, but `agent/src/worker.ts` imports shared code straight from the
main app's `src/` tree by relative path (`../../src/lib/providers/speech-to-text.ts`,
`../../src/lib/session-contracts.ts`), resolved via the `@/*` -> `../src/*`
path mapping in `agent/tsconfig.json`. That means:

- **Root `src/` changes can break this worker.** Renaming, moving, or
  changing the exported shape of anything under `src/lib/providers/` or
  `src/lib/session-contracts.ts` needs a check against `agent/src/worker.ts`'s
  usage, not just the Next.js app's own call sites.
- **`npm install` here alone isn't enough for those shared imports' own
  dependencies** (e.g. `ws`, imported by `speech-to-text.ts`). Local dev works
  because Node's module resolution walks up parent directories and finds the
  root repo's `node_modules` once it's resolving a file that physically lives
  in `<repo>/src/` — but that only works if the root app's `npm install` has
  already been run too. `agent/Dockerfile` handles this explicitly (installs
  both the root's and this package's `node_modules` — read its header
  comment before changing it) and its build context in `docker-compose.yml`
  is the repo root, not `agent/`, for the same reason.
- **Don't "fix" this by copying/duplicating the provider code into `agent/`.**
  It's intentionally the *same* code as the browser-mic caption path
  (`LiveCaptionStream`/`/api/captions/stream`) — see the docstring on
  `streamFacilitatorAudio` in `worker.ts`. Diverging the two would silently
  desync behavior between the two capture paths.

## Why HTTP instead of importing `@/lib/db` directly

Already explained at length in `agent/README.md`'s "Why this is a separate
package" section — the short version: a prior attempt at importing Prisma
directly broke under tsx's module resolution. Don't re-attempt that; extend
`CaptionAgentClient` in `worker.ts` and the `/api/captions/agent` route
instead if this worker needs more from the app.

## No test suite here

There's no test runner configured for `agent/` (unlike `src/` and
`local-inference/`, both of which have one — see their own AGENTS.md/README).
If you add non-trivial logic to `worker.ts` beyond what
`streamFacilitatorAudio`/`CaptionAgentClient` already do, consider whether it
belongs in `src/lib/providers/` instead, where it'd inherit that test
coverage and Vitest setup for free.
