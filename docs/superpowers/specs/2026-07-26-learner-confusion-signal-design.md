# Per-learner confusion signal — design

## Problem

The group confusion gauge (see
`docs/superpowers/specs/2026-07-26-group-confusion-gauge-design.md`) tells
the facilitator the group as a whole is confused, but not *who*. That
design explicitly listed per-learner sentiment as a non-goal.

## Why not attribute existing CONFUSION insights to a speaker?

`TranscriptSegment.speakerId` looks like the obvious join, but it doesn't
work here: it's only ever set when a learner explicitly types a caption
(`learn/actions.ts`, a rare path). The facilitator's live-transcribed
speech — which is what `generateSessionInsights` actually analyzes to
produce CONFUSION insights — always has `speakerId = null`
(`captions.ts`, `caption-agent.ts`, `facilitator/actions.ts`). Confusion is
inferred from what the facilitator said, not from anything a specific
learner said, so there is no reliable per-learner join through this path.

## Data source

Two UI entry points both produce a `Message` with `kind: "QUESTION"`
attributed to a real `senderId`, with no field distinguishing which one was
used: learner caption-comprehension actions (`CaptionComprehensionActions.tsx`,
added for issue #89 — "Explain simply" / "Give an example" about a caption),
and the plain "Question" checkbox in the regular chat composer
(`SessionChatPanel.tsx`, via `src/app/sessions/actions.ts`). Either is a
genuine, self-reported, per-learner confusion signal — no new LLM call, no
schema change — so both are treated as the same signal.

`facilitator/page.tsx` already fetches `session.messages` (`sender: true`,
capped at `MESSAGE_HISTORY_LIMIT`) and `session.participants` (role
`LEARNER`, giving `userId` per learner). Filter messages to
`kind === "QUESTION"` where `senderId` is in the learner participant
`userId` set (excludes the facilitator's own use of the same QUESTION
checkbox in `SessionChatPanel`).

## Computation

New pure function `src/lib/learner-confusion.ts`, deliberately mirroring
`computeConfusionLevel`'s shape and thresholds so the two signals read
consistently:

```ts
export type LearnerConfusionLevel = "SOME" | "HIGH";

export function computeLearnerConfusionLevels(
  questionMessages: { senderId: string; sentAt: Date }[],
  learnerUserIds: ReadonlySet<string>,
  now: Date,
  windowMs: number = 10 * 60 * 1000,
): Array<{ userId: string; level: LearnerConfusionLevel; count: number }>
```

- Same rolling 10-minute window and 1–2 → SOME / 3+ → HIGH thresholds as
  `computeConfusionLevel`, applied per `senderId` instead of session-wide.
- Only learners with count ≥ 1 in the window appear in the result (no
  CALM entries — nothing to show for a learner with zero recent
  questions).
- Messages from a `senderId` not in `learnerUserIds` (i.e. the
  facilitator) are ignored.
- Sorted by count descending, so the facilitator sees the most-confused
  learner first.

## UI

In `facilitator/page.tsx`, next to the existing group confusion badge in
the "Act now" header area: a small inline list of learner names with their
level/count, using each learner's `session.participants` display name
(joined via `userId`). Same visual language as the group badge (reuses
`--tick-high`/`--tick-medium` color tokens), hidden entirely when the list
is empty — consistent with the group badge's and the page's existing
empty-state pattern.

Example: `Ana (High confusion · 3)` · `Wei (Some confusion · 1)`

## i18n

No new dict keys — reuses the existing `confusionLevelSome`/
`confusionLevelHigh` count-taking functions from the group gauge, prefixed
with the learner's display name in the component (display name itself
isn't a translatable string).

## Testing

`src/lib/learner-confusion.test.ts` (colocated, Vitest):
- Empty input → empty result.
- One learner, 1 question in window → SOME, count 1.
- One learner, 3 questions in window → HIGH, count 3.
- Two learners with different counts → both present, sorted by count
  descending.
- A message from a non-learner `senderId` (facilitator) → excluded.
- Window boundary (inclusive/exclusive) and future-timestamp guard, same
  as `computeConfusionLevel`'s existing tests.

No new e2e coverage — pure derived display, same rationale as the group
gauge.

## Non-goals

- A full sentiment spectrum beyond the existing QUESTION signal.
- Persisting or exposing this in the post-session summary (that's the
  separate "Summaries" to-do item).
- Historical trend / sparkline per learner.
