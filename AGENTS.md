<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

## Repo layout

This is a monorepo of three independently-deployable pieces — see
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for how they're built/deployed
together (Docker Compose locally, Railway in production) and [`SKILLS.md`](SKILLS.md)
for common cross-cutting tasks:

| Directory | What | Its own AGENTS.md / SKILLS.md |
| --- | --- | --- |
| `src/` | The Next.js app itself, including the in-process LiveKit caption agent worker (`src/lib/caption-agent.ts`, registered from `server.ts`) | [`src/AGENTS.md`](src/AGENTS.md) / [`src/SKILLS.md`](src/SKILLS.md) |
| `local-inference/` | Self-hosted FastAPI translation/STT/TTS service | [`local-inference/AGENTS.md`](local-inference/AGENTS.md) / [`local-inference/SKILLS.md`](local-inference/SKILLS.md) |
| `prisma/` | Schema + migrations for the shared Postgres database | — |

Read the AGENTS.md for whichever directory you're changing before writing code
in it — each has conventions specific to that package that aren't obvious from
the code alone.
<!-- END:nextjs-agent-rules -->
