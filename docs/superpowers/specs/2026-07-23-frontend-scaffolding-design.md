# Frontend Scaffolding Design — Cross-Lingual Remote Workshop Facilitation

Builds on `docs/problem_statement.md` and `docs/approaches.md`. Targets a combination of
**Approach 1 (Live Status Dashboard)** and **Approach 4 (Trustworthy Translation)**: a
facilitator-focused dashboard where every AI claim is backed by a translated quote, and
code/jargon/error-message spans are preserved untranslated with a confidence flag on the
rest.

## Scope

Frontend-only scaffolding: page structure, navigation, and layout with mock/placeholder
data. No backend, no route handlers, no live AI/STT/translation wiring in this pass —
that comes later once this UI shape is validated.

## Pages (Next.js 16 App Router, `src/app/`)

| Route | Purpose |
|---|---|
| `/setup` | Facilitator enters the workshop goal/context once, before a session starts. |
| `/dashboard` | Live facilitator view: Goal / Current Activity / Decisions / Blockers panels, a transcript feed (translated quotes, preserved code/jargon spans, confidence flags), and a reply box. |
| `/learner` | Learner-facing view: original + translated facilitator replies. |
| `/history` | Past catch-up summaries, for a facilitator joining mid-session or reviewing after. |

Each page is a Server Component rendering mock data by default; only the interactive
bits (reply box, setup form) are Client Components (`'use client'`).

## Shared components (`src/components/`)

- `AppShell` — nav between the four pages (`next/link`)
- `GoalPanel`, `ActivityPanel`, `DecisionsPanel`, `BlockerCard` — dashboard panels
- `TranscriptEntry` — one transcript line: original quote, translation, confidence badge,
  preserved-span styling for code/jargon
- `SummaryCard` — used by both `/history` and the blocker/catch-up surfaces

All components take mock data via props (typed with local interfaces) so wiring real
data later is a prop-source swap, not a rewrite.

## Next.js 16 conventions to follow

- `params`/`searchParams` are async where used (not needed for these static routes)
- Use the auto-generated `PageProps<'/route'>` typed helpers instead of hand-rolled prop types
- Server Components by default; `'use client'` only where interactivity is needed
- `next/link` for all internal navigation
- `eslint` directly for linting (`next lint` is removed)

## Deliverables

1. Scaffolded pages + components above, mock data only
2. A Mermaid page-flow/navigation diagram and a data-flow diagram (adapted from
   `docs/approaches.md`'s combined-approach pipeline) in `docs/` alongside this spec
3. Screenshots of each of the four pages (captured via dev server + browser) checked
   into `docs/` or linked in the PR description
4. One GitHub issue per page/component area, opened before implementation
5. A single PR bundling the scaffolding work against `main`, referencing the issues,
   with no merge conflicts (rebase/sync before opening)

## Out of scope

- Any backend/API route handlers
- Real STT/translation/LLM integration
- Auth, persistence, multi-session state
