# Authentication & PostgreSQL Hosting Decision

Closes #53. This is the architecture decision record (ADR) the issue asks for:
which auth provider and which managed PostgreSQL host the app should run on,
so facilitator/participant identity and workshop data have a real home instead
of the current local-only setup.

## Current state

The app already has a working, custom access-control layer — it is **not**
starting from zero:

| Concern | File | Status |
| --- | --- | --- |
| Facilitator/learner access | [`src/lib/session-access.ts`](../src/lib/session-access.ts) | Implemented — cookie + hashed token, checked against `JoinLink` / `SessionParticipant` |
| Cookie/token security | [`src/lib/session-security.ts`](../src/lib/session-security.ts) | Implemented — per-session cookie names, token hashing |
| Database access | [`src/lib/db.ts`](../src/lib/db.ts), `prisma/schema.prisma` | Implemented — Prisma over a single `DATABASE_URL`, currently pointed at local Postgres only (see `.env.example`) |

What's missing, per the issue: a **managed** Postgres host (today `DATABASE_URL`
only documents a `localhost` connection) and a decision on whether facilitator
accounts should move to a dedicated identity provider as the product grows
past single-workshop, invite-link access.

## Decision

**Option 2 — Clerk (auth) + Railway (PostgreSQL)**, per the issue's recommended
direction and the explicit "choose railway" instruction on this task.

```mermaid
flowchart LR
    subgraph Browser
        UI["Facilitator sign-in / org UI"]
    end

    subgraph Clerk[Clerk]
        Auth["Session + JWT\nusers, orgs, invitations"]
    end

    subgraph App[Next.js app — Vercel]
        MW["Clerk middleware\n(replaces cookie checks in\nsession-access.ts)"]
        API["API routes / server actions"]
        Legacy["JoinLink / SessionParticipant\nlearner access (kept as-is)"]
    end

    subgraph Railway[Railway]
        PG[("Managed PostgreSQL")]
    end

    UI --> Auth
    Auth -->|JWT| MW
    MW --> API
    API -->|Prisma over DATABASE_URL| PG
    Legacy -->|Prisma| PG
    API --> Legacy
```

Why this option over the other two evaluated in the issue:

| Criterion | Supabase (Option 1) | Clerk + Railway (Option 2) | Clerk + Neon (Option 3) |
| --- | --- | --- | --- |
| Fits existing model (facilitator = privileged account, learner = anonymous invite link) | Auth + DB coupled — harder to keep the learner-side anonymous-link flow separate from Supabase's user table | **Clean split**: Clerk only ever manages facilitator/org accounts; learner access stays exactly as implemented today | Same split as Option 2 |
| Organizations & invitations (needed for "workshops belong to a company" later) | Basic, needs custom RLS policies | **Built-in** (Clerk Organizations) | Built-in (same Clerk) |
| DB portability if we ever leave the host | Tied to Supabase's Postgres | **Plain managed Postgres**, `DATABASE_URL` only — Prisma doesn't know or care it's Railway | Plain Postgres, but serverless branching adds cold-start/connection-pooling nuance for a WebSocket-heavy, long-lived-session app |
| Ops simplicity for this stage | One dashboard | Two dashboards, but each does one job | Two dashboards |
| Explicit ask this task | — | **"choose railway"** | — |

Railway PostgreSQL over Neon specifically because this app holds long-lived
LiveKit session connections and does frequent small writes (transcript
segments, dashboard state) — a fixed, always-on Postgres instance avoids the
serverless connect/suspend latency Neon's branching model introduces, and
Railway's `DATABASE_URL` output is a drop-in replacement for what
`prisma/schema.prisma` already expects.

## What does *not* change

- **`SessionParticipant` / `JoinLink` learner access stays exactly as-is.**
  Learners join via QR/link, no account, no Clerk — this is a deliberate
  low-friction design already built and shipped; Clerk only covers
  facilitator (and future org-admin) accounts.
- **Hosting stays Vercel** (see `README.md#architecture`). Railway is scoped
  to the database only in this decision, not app hosting — keeping the app on
  Vercel's Fluid Compute avoids a second deploy target for zero benefit.
- **Prisma stays the data-access layer.** Moving `DATABASE_URL` to a Railway
  connection string is a config change, not a code change.

## Migration plan (facilitator accounts: cookie session → Clerk)

```mermaid
sequenceDiagram
    participant F as Facilitator
    participant Clerk
    participant MW as Clerk middleware
    participant App as Next.js app
    participant DB as Railway Postgres

    F->>Clerk: Sign in (email, social, or magic link)
    Clerk-->>F: Session JWT
    F->>App: Request /dashboard (JWT in cookie)
    App->>MW: clerkMiddleware() validates JWT
    MW->>App: attaches userId, orgId
    App->>DB: Prisma query, scoped by Clerk userId/orgId
    DB-->>App: Facilitator's workshops
```

1. Add `@clerk/nextjs`, wrap the root layout in `<ClerkProvider>`, add
   `clerkMiddleware()` in `middleware.ts`.
2. Add a `clerkUserId` column to the `User`/`Facilitator` model (Prisma
   migration) — Clerk remains the identity source of truth, Postgres stores
   the app-specific rows keyed off it.
3. Replace the facilitator branch of `hasFacilitatorAccess()` in
   `session-access.ts` with a Clerk `auth()` check; leave the learner branch
   (`learnerParticipantId`) untouched.
4. Point `DATABASE_URL` at the Railway connection string (below) and run
   `prisma migrate deploy` against it.

This is left as a follow-up implementation PR — this ADR's scope is the
provider decision plus the DB connection being live, per #53.

## Railway PostgreSQL setup

1. `railway login`, then `railway init` in the repo (or create the project in
   the Railway dashboard).
2. Add a PostgreSQL plugin/service to the project.
3. Copy the generated connection string into `DATABASE_URL` — Railway exposes
   it as `${{Postgres.DATABASE_URL}}` for service-to-service reference, or as
   a plain `postgresql://user:pass@host:port/db` string for external clients
   (Vercel-hosted app connecting in).
4. On Vercel: `vercel env add DATABASE_URL` (production + preview), pasting
   the Railway external connection string.
5. Run `npx prisma migrate deploy` once against the Railway database to
   create the schema.

`.env.example` now documents this explicitly (see below) instead of only
showing the `localhost` shape.

## Answers to the issue's open questions

- **Direct signup vs. invitation-only:** Facilitators sign up directly via
  Clerk; learners never get accounts — they join through the existing
  `JoinLink` invite-link flow. No change to the learner UX.
- **Organizations:** Deferred, but the choice is made so it's cheap later —
  Clerk Organizations map naturally onto "workshops belong to a company"
  without a schema rewrite (`orgId` alongside `clerkUserId`).
- **Enterprise SSO/SAML:** Clerk supports SAML/SSO on paid tiers; not needed
  for MVP, available without a provider migration if/when needed.
- **One provider vs. separated:** Separated, by design (see decision table) —
  identity and data-of-record are different concerns with different scaling
  and portability needs for this app.
