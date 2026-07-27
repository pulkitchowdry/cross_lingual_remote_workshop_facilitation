# Next.js app image. No `output: standalone` — this repo's Prisma client uses
# driver adapters (@prisma/adapter-pg), and the `prisma` CLI itself (needed
# for `migrate deploy` at container start, see docker-entrypoint.sh) is a
# regular (non-dev) dependency, so a `--omit=dev` install still keeps it, with
# zero manual re-assembly of its transitive deps.
#
# `npm start` runs the custom `server.ts` (via `tsx`, see package.json), not
# plain `next start` — it registers the raw WebSocket upgrade handler and the
# in-process LiveKit caption agent worker (see server.ts's own comments).
# `tsx` transpiles that file (and everything it imports under `src/`,
# including the generated Prisma client at `src/generated/prisma` — see
# src/AGENTS.md) on the fly at runtime rather than through `next build`'s
# bundler, so all three — `server.ts`, `tsconfig.json` (for the `@/*` path
# alias), and `src/` itself — must be copied into the runner stage below, not
# just `.next`/`public`.

# Prisma's CLI probes for OpenSSL to pick a query-engine build even though this
# app's driver-adapter setup never loads that engine — without it, `prisma
# generate`/`migrate deploy` still work but print a misleading warning on
# every run. `ca-certificates` is NOT one of `node:*-bookworm-slim`'s default
# packages; Node's own `fetch`/`https` don't need it (they verify against a
# root-CA store compiled into the Node binary itself), but the LiveKit Agents
# worker's native RTC client (`@livekit/rtc-node`, a compiled Rust addon using
# the OS's OpenSSL trust store, not Node's) does — worth keeping even though
# it wasn't the cause of the specific failure below (see the `gai.conf` fix),
# since a genuinely missing system trust store is its own latent problem.
# Installed once here and reused by every stage below.
FROM node:24-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Some hosts (confirmed on Railway) advertise a AAAA/IPv6 record with no
# actual working IPv6 route out of the container (`connect()` fails
# `ENETUNREACH`, not a firewall-style refusal) — LiveKit Cloud's regional
# room-redirect endpoints are one such host. Node's own `fetch()` isn't
# affected (undici does Happy-Eyeballs dual-stack fallback and silently
# succeeds via IPv4), but `@livekit/rtc-node`'s native Rust client resolves
# through the OS's `getaddrinfo()` and doesn't fall back the same way: it
# exhausts the IPv6 candidates glibc hands it first, gets `ENETUNREACH` on
# both, and gives up — surfacing as `ctx.connect()` throwing "failed to
# retrieve region info: error sending request" for every session, everywhere.
# This is the classic, standard fix (RFC 3484/6724 address-sort precedence):
# raising IPv4-mapped addresses' precedence above native IPv6's default (40)
# makes `getaddrinfo()` return IPv4 candidates first, so a client that tries
# addresses in order succeeds on the first attempt and never reaches the
# broken IPv6 ones. System-wide and Debian's default `/etc/gai.conf` ships
# every precedence rule commented out, so this only adds the one line that
# actually changes behavior.
RUN echo "precedence ::ffff:0:0/96  100" >> /etc/gai.conf

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Separate from `deps` (which `builder` uses and which includes devDependencies
# like TypeScript/Tailwind that `next build` itself needs): the runner only
# needs production dependencies, which noticeably shrinks the final image.
FROM base AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM base AS builder
WORKDIR /app
# Build-time-only placeholder: prisma.config.ts's env("DATABASE_URL") and
# src/lib/db.ts's assertRequiredEnv() both require the var to be *present*
# during `prisma generate`/`next build`, even though neither actually
# connects to it at this stage (the host/port/credentials here are never
# dialed — this never needs to match docker-compose.yml's actual Postgres
# port). The real value comes from the runtime environment
# (docker-compose.yml / Railway variables), not this image.
ENV DATABASE_URL="postgresql://user:password@localhost:5432/db"
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./package.json
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh && chown -R nextjs:nodejs /app

USER nextjs
ENV PORT=3000
EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["npm", "start"]
