# Next.js app image. Plain `next start` (no `output: standalone`) — this repo's
# Prisma client uses driver adapters (@prisma/adapter-pg), and the `prisma` CLI
# itself (needed for `migrate deploy` at container start, see docker-entrypoint.sh)
# is a regular (non-dev) dependency, so a `--omit=dev` install still keeps it,
# with zero manual re-assembly of its transitive deps.

# Prisma's CLI probes for OpenSSL to pick a query-engine build even though this
# app's driver-adapter setup never loads that engine — without it, `prisma
# generate`/`migrate deploy` still work but print a misleading warning on
# every run. Installed once here and reused by every stage below.
FROM node:24-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

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
COPY --from=builder /app/package.json ./package.json
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh && chown -R nextjs:nodejs /app

USER nextjs
ENV PORT=3000
EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["npm", "start"]
