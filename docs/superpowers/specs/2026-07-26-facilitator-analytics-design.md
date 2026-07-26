# Facilitator Analytics — Design

## Context

The facilitator dashboard (`src/app/sessions/[sessionId]/facilitator/page.tsx`) already
surfaces confusion signals (group gauge + per-learner badges, PRs #114/#116) and a basic
post-session `sessionSummary` card (duration, message/question counts, misunderstood
topics). There is no dedicated analytics view aggregating trends over time,
participation, blocker resolution, or language/translation stats. This is status item 9
("Analytics for facilitator") — genuinely unstarted, no existing branch/PR.

Goal: give facilitators visibility into session health, both live and after the fact,
built entirely on data that already exists (`Insight`, `Message`, `SessionParticipant`,
`TranscriptSegment`/`Translation`) — no new ML model, no new sentiment work (that's
item 8, already merged).

## Scope

In scope:
- Confusion trend over time (time-series view of the existing group/per-learner
  confusion signals)
- Participation breakdown (messages/questions per learner, anonymous vs named)
- Blocker/decision resolution (raised vs resolved, open at session end)
- Language/translation stats (languages used, translation volume)
- Both a live in-session view and a post-session report, sharing one aggregation
  implementation

Out of scope:
- Any new sentiment/ML signal (confusion detection is already built)
- Cross-session/historical analytics (this is single-session only)
- Exporting analytics (CSV/PDF) — not requested

## Architecture

### `src/lib/facilitator-analytics.ts` (new)

Pure functions, following the existing pattern in `src/lib/confusion-level.ts` and
`src/lib/learner-confusion.ts`: take already-fetched `Insight[]`, `Message[]`,
`SessionParticipant[]`, `TranscriptSegment[]`/`Translation[]` and return a structured
`FacilitatorAnalytics` object:

```ts
type FacilitatorAnalytics = {
  confusionTrend: { timestamp: Date; groupLevel: number }[];
  participation: { participantId: string; messages: number; questions: number; isAnonymous: boolean }[];
  blockers: { raised: number; resolved: number; open: number; avgResolutionMs: number | null };
  languages: { language: string; translationCount: number }[];
};
```

No DB writes. No new ML. Defensive against empty/partial data (zero messages, zero
blockers, single participant), matching the style already used in
`confusion-level.ts`.

### `src/app/api/sessions/[sessionId]/analytics/route.ts` (new)

Loads session records via existing Prisma queries and calls
`facilitator-analytics.ts`. Serves both:
- **Live polling** from the drawer, at the same refresh cadence the facilitator page
  already uses to refresh confusion badges (no new interval/transport introduced)
- **Post-session single fetch**, triggered once when session status flips to ended —
  result is treated as final and not re-polled

If server-side computation from the page's own already-loaded data turns out cheaper
than a round-trip (the facilitator page may already be a Server Component with this
data in hand), the implementer may call `facilitator-analytics.ts` directly from the
page instead of going through the API route — the aggregation module is the reusable
unit either way; the route is only needed for client-side polling.

### `AnalyticsDrawer` component (new, client component)

Collapsible sidebar docked to the facilitator page, four sections matching the four
metric groups above. Post-session, the same drawer renders "frozen" (final
aggregation, no further polling) — extends/replaces the existing static
`sessionSummary` card rather than introducing a second, separate report artifact.

## Data flow

1. Facilitator page already fetches the underlying records for the existing dashboard
   (Insight, Message, SessionParticipant, TranscriptSegment/Translation).
2. Live: drawer polls the analytics route on the same cadence as existing confusion
   refresh; drawer content re-renders on each response.
3. Post-session: once, at the same point `sessionSummary` is currently computed;
   result persisted alongside the existing summary rather than fetched again later.

## Error handling

- Aggregation functions are pure and tolerant of sparse/empty input arrays.
- If a live analytics fetch fails, the drawer shows a small inline error state; the
  rest of the facilitator dashboard (confusion badges, blockers, activity log) keeps
  working — analytics is additive, never blocking.

## Testing

- Colocated Vitest unit tests for `facilitator-analytics.ts`: confusion trend
  bucketing, participation counts, blocker resolution ratios, language breakdown —
  using fixture `Insight`/`Message`/`SessionParticipant` arrays, matching existing
  test conventions in `src/`.
- Manual verification via the `/run` skill: open a live session as facilitator,
  confirm the drawer opens/closes, populates during activity, and freezes correctly
  post-session.

## Delivery

Per user instruction (status item 9): implement, raise a PR and an issue, include a
screenshot and a mermaid diagram in the PR description, and avoid merge conflicts with
other in-flight work (items 1–8, e.g. whiteboard merge, private messages, deployment).
No merge into `main` without explicit approval.
