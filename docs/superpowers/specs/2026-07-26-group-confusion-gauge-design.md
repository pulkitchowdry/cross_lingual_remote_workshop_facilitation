# Group confusion level gauge — design

## Problem

The facilitator dashboard already detects individual `CONFUSION` insights
(LLM-derived, one per incident, shown as a card in "Act now" — see
`src/lib/providers/insight.ts` and `src/lib/insights.ts`). What's missing is
a glanceable, aggregate signal: is the *group as a whole* currently
confused, right now, without the facilitator having to read/count
individual cards?

## Goals

- Show a small badge next to the "Act now" heading summarizing recent group
  confusion, e.g. "Some confusion (2)" / "High confusion (4)".
- No new LLM calls, no new provider, no schema change — derive purely from
  `Insight` rows the existing pipeline already writes.
- Hidden entirely when there's nothing to report (consistent with the
  existing "on track" / empty-state pattern already in `facilitator/page.tsx`).

## Non-goals

- Per-learner sentiment tracking (out of scope for this iteration).
- A full sentiment spectrum (frustrated/engaged/positive) — confusion only,
  matching what the existing pipeline already detects.
- A historical trend chart/sparkline — a single current-level badge only.

## Data source & computation

New pure function `src/lib/confusion-level.ts`:

```ts
export type ConfusionLevel = "CALM" | "SOME" | "HIGH";

export function computeConfusionLevel(
  confusionInsightTimestamps: Date[],
  now: Date,
  windowMs: number = 10 * 60 * 1000,
): { level: ConfusionLevel; count: number } {
  const count = confusionInsightTimestamps.filter(
    (t) => now.getTime() - t.getTime() <= windowMs && t.getTime() <= now.getTime(),
  ).length;
  if (count === 0) return { level: "CALM", count };
  if (count <= 2) return { level: "SOME", count };
  return { level: "HIGH", count };
}
```

- Window: rolling 10 minutes from "now" (page render time).
- Thresholds: 0 → CALM, 1–2 → SOME, 3+ → HIGH.
- Input is both ACTIVE and RESOLVED `CONFUSION` insights — resolution means
  the facilitator responded, not that the confusion didn't happen; a recent
  burst of resolved confusion is still a signal the group is having a hard
  time (this matches the existing rationale in `page.tsx` for why a
  resolved insight's *recurrence* is still worth re-surfacing).
- No new query: `facilitator/page.tsx` already fetches `session.insights`
  (newest-first, capped at `INSIGHT_HISTORY_LIMIT`). Filter that in-memory
  list to `type === "CONFUSION"`, map to `createdAt`, pass to
  `computeConfusionLevel`.

Caveat: because the input is capped at `INSIGHT_HISTORY_LIMIT` (50, newest
first) rather than a dedicated time-bounded query, a session with 50+ newer
non-CONFUSION insights in the same cap window could in theory undercount.
Accepted as a known limitation — matches the existing "Current lesson"
section's same tradeoff one section below it, and a facilitator dashboard
this insight-dense is already an edge case.

## UI

In `facilitator/page.tsx`, next to the existing "Act now" `<h2>`:

```tsx
<div className="flex flex-wrap items-end justify-between gap-3">
  <div className="flex items-center gap-2">
    <h2 className="...">{dict.actNow}</h2>
    {confusionLevel.level !== "CALM" && (
      <span
        className="font-data rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider"
        style={{
          color: confusionLevel.level === "HIGH" ? "var(--tick-low)" : "var(--tick-medium)",
          borderColor: "currentColor",
        }}
      >
        {confusionLevel.level === "HIGH"
          ? dict.confusionLevelHigh(confusionLevel.count)
          : dict.confusionLevelSome(confusionLevel.count)}
      </span>
    )}
  </div>
</div>
```

Reuses the existing `--tick-high/medium/low` color tokens already used to
distinguish BLOCKER vs CONFUSION cards, so the badge's color language is
consistent with cards already on the page.

## i18n

Two new dict entries per locale (en/zh/es) in `src/lib/i18n.ts`, alongside
the existing `confusion`/`actNow` keys. Since the label needs to embed a
count, use a function value (`(count: number) => string`) rather than a
plain string, matching how this codebase already handles parameterized
strings (check `learnersJoinedCard`/existing dict for the established
pattern before deciding function vs. plain-string-with-replace).

Example (en):
- `confusionLevelSome: (n) => \`Some confusion (${n})\``
- `confusionLevelHigh: (n) => \`High confusion (${n})\``

## Testing

`src/lib/confusion-level.test.ts` (colocated, Vitest, matches repo
convention):
- Empty list → CALM, count 0.
- 1 timestamp inside window → SOME, count 1.
- 3 timestamps inside window → HIGH, count 3.
- Timestamp exactly at the window boundary (inclusive) and just outside it
  (excluded).
- Timestamps in the future relative to `now` (shouldn't happen in practice,
  but excluded defensively — matches `<= now.getTime()` guard above).
- Mix of in-window and out-of-window timestamps → only in-window counted.

No new e2e coverage needed — this is a pure derived display, no new
server action or state mutation.
