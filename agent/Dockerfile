# Build context is the repo root (see docker-compose.yml's `agent` service:
# `context: .`, `dockerfile: agent/Dockerfile`), not this directory — the
# worker imports shared provider code straight from the main app's `src/`
# (agent/src/worker.ts -> ../../src/lib/providers/speech-to-text.ts, per
# agent/tsconfig.json's `@/*` -> `../src/*` mapping; see agent/README.md for
# why it doesn't reach into `@/lib/db` the same way). That means this image
# needs the root app's node_modules too (for that shared code's own runtime
# deps, e.g. `ws`), on top of this worker's own (`tsx`, `@livekit/agents`).
#
# Single stage — tsx runs the TypeScript source directly, so there's no build
# artifact to separate out, and tsx is a devDependency but required at
# runtime here: `--include=dev` overrides the `NODE_ENV=production` below,
# which would otherwise make `npm ci` silently skip it.

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src

COPY agent/package.json agent/package-lock.json ./agent/
RUN npm ci --prefix agent --include=dev
COPY agent/src ./agent/src
COPY agent/tsconfig.json ./agent/tsconfig.json

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs agent \
    && chown -R agent:nodejs /app
USER agent

WORKDIR /app/agent
CMD ["npm", "run", "start"]
