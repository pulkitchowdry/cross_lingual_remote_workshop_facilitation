#!/bin/sh
# Applies pending migrations before every start — `prisma migrate deploy` is a
# no-op when the schema is already current, so this is safe on every
# container boot/restart, not just the first one.
#
# Retries instead of failing immediately: `depends_on: condition:
# service_healthy` (docker-compose.yml) should mean Postgres already accepts
# connections by the time this runs, but the official Postgres image restarts
# itself once internally on a first-ever boot (after initdb) — a healthcheck
# can observe "accepting connections" right before that restart, so a
# same-second connection attempt can still race it. Retrying here is a
# portable backstop that doesn't depend on Compose's version or timing.
set -e

attempt=1
max_attempts=30
until npx prisma migrate deploy; do
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "docker-entrypoint: database still unreachable after $max_attempts attempts, giving up." >&2
    exit 1
  fi
  echo "docker-entrypoint: database not ready yet (attempt $attempt/$max_attempts) — retrying in 2s..."
  attempt=$((attempt + 1))
  sleep 2
done

exec "$@"
