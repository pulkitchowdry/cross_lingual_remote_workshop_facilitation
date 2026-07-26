# Group Confusion Level Gauge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a small badge next to the facilitator dashboard's "Act now" heading summarizing recent group confusion (Calm / Some / High), derived entirely from `CONFUSION` insights the app already generates — no new LLM calls, no schema change.

**Architecture:** A new pure function (`computeConfusionLevel`) buckets the timestamps of recent `CONFUSION` insights (already fetched by `facilitator/page.tsx` via `session.insights`) into a 10-minute rolling window and maps the count to a 3-level enum. The page renders a small colored badge next to the "Act now" `<h2>` when the level isn't CALM, reusing the existing `--tick-high/medium/low` CSS variables.

**Tech Stack:** TypeScript, Next.js (App Router, Server Components), Vitest for tests. No new dependencies.

## Global Constraints

- No new LLM calls, no new provider, no Prisma schema change (per spec).
- Window: rolling 10 minutes (`10 * 60 * 1000` ms) from render time.
- Thresholds: 0 → `CALM`, 1–2 → `SOME`, 3+ → `HIGH`.
- Count both ACTIVE and RESOLVED `CONFUSION` insights (resolution ≠ "didn't happen").
- Badge hidden entirely when level is `CALM`.
- i18n: add entries to all three locales (en, zh, es) in `src/lib/i18n.ts` using the codebase's existing function-valued dict pattern for parameterized strings (e.g. `textSizeAriaLabel: (label: string) => string` at `src/lib/i18n.ts:23`), not string concatenation/replace.
- Colocated Vitest test file per repo convention (`src/AGENTS.md` "Testing" section).

---

### Task 1: `computeConfusionLevel` pure function + tests

**Files:**
- Create: `src/lib/confusion-level.ts`
- Test: `src/lib/confusion-level.test.ts`

**Interfaces:**
- Consumes: nothing (pure function, no repo dependencies).
- Produces:
  ```ts
  export type ConfusionLevel = "CALM" | "SOME" | "HIGH";

  export function computeConfusionLevel(
    confusionInsightTimestamps: Date[],
    now: Date,
    windowMs?: number, // defaults to 10 * 60 * 1000
  ): { level: ConfusionLevel; count: number };
  ```
  Later tasks (Task 2) import `computeConfusionLevel` and the `ConfusionLevel` type from `@/lib/confusion-level`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/confusion-level.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeConfusionLevel } from "@/lib/confusion-level";

const NOW = new Date("2026-07-26T12:00:00.000Z");
const WINDOW_MS = 10 * 60 * 1000;

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
}

describe("computeConfusionLevel", () => {
  it("returns CALM with count 0 for an empty list", () => {
    expect(computeConfusionLevel([], NOW)).toEqual({ level: "CALM", count: 0 });
  });

  it("returns SOME for 1 timestamp inside the window", () => {
    expect(computeConfusionLevel([minutesAgo(5)], NOW)).toEqual({ level: "SOME", count: 1 });
  });

  it("returns SOME for 2 timestamps inside the window", () => {
    expect(computeConfusionLevel([minutesAgo(1), minutesAgo(9)], NOW)).toEqual({ level: "SOME", count: 2 });
  });

  it("returns HIGH for 3 timestamps inside the window", () => {
    expect(computeConfusionLevel([minutesAgo(1), minutesAgo(2), minutesAgo(3)], NOW)).toEqual({
      level: "HIGH",
      count: 3,
    });
  });

  it("returns HIGH for more than 3 timestamps inside the window", () => {
    expect(
      computeConfusionLevel([minutesAgo(1), minutesAgo(2), minutesAgo(3), minutesAgo(4), minutesAgo(5)], NOW),
    ).toEqual({ level: "HIGH", count: 5 });
  });

  it("includes a timestamp exactly at the window boundary", () => {
    const exactlyAtEdge = new Date(NOW.getTime() - WINDOW_MS);
    expect(computeConfusionLevel([exactlyAtEdge], NOW)).toEqual({ level: "SOME", count: 1 });
  });

  it("excludes a timestamp just outside the window boundary", () => {
    const justOutside = new Date(NOW.getTime() - WINDOW_MS - 1);
    expect(computeConfusionLevel([justOutside], NOW)).toEqual({ level: "CALM", count: 0 });
  });

  it("excludes timestamps in the future relative to now", () => {
    const future = new Date(NOW.getTime() + 60_000);
    expect(computeConfusionLevel([future], NOW)).toEqual({ level: "CALM", count: 0 });
  });

  it("counts only in-window timestamps from a mixed list", () => {
    expect(computeConfusionLevel([minutesAgo(1), minutesAgo(20), minutesAgo(3)], NOW)).toEqual({
      level: "SOME",
      count: 2,
    });
  });

  it("respects a custom windowMs override", () => {
    expect(computeConfusionLevel([minutesAgo(4)], NOW, 3 * 60 * 1000)).toEqual({ level: "CALM", count: 0 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/confusion-level.test.ts`
Expected: FAIL — `Cannot find module '@/lib/confusion-level'` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/lib/confusion-level.ts`:

```ts
export type ConfusionLevel = "CALM" | "SOME" | "HIGH";

const DEFAULT_WINDOW_MS = 10 * 60 * 1000;

/**
 * Derives a glanceable group-confusion signal from the timestamps of
 * CONFUSION insights the existing insight pipeline already generates
 * (see src/lib/insights.ts) — no new LLM call, no new data source.
 * Both ACTIVE and RESOLVED CONFUSION insights count: resolution means the
 * facilitator responded, not that the confusion didn't happen.
 */
export function computeConfusionLevel(
  confusionInsightTimestamps: Date[],
  now: Date,
  windowMs: number = DEFAULT_WINDOW_MS,
): { level: ConfusionLevel; count: number } {
  const count = confusionInsightTimestamps.filter((timestamp) => {
    const age = now.getTime() - timestamp.getTime();
    return age >= 0 && age <= windowMs;
  }).length;

  if (count === 0) return { level: "CALM", count };
  if (count <= 2) return { level: "SOME", count };
  return { level: "HIGH", count };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/confusion-level.test.ts`
Expected: PASS, all 10 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/confusion-level.ts src/lib/confusion-level.test.ts
git commit -m "Add computeConfusionLevel for aggregate group confusion signal"
```

---

### Task 2: i18n dict entries for all three locales

**Files:**
- Modify: `src/lib/i18n.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `dict.facilitator.confusionLevelSome(count: number): string` and `dict.facilitator.confusionLevelHigh(count: number): string`, available on the `Dictionary["facilitator"]` type and on all three locale objects (`en`, `zh`, `es`). Task 3 calls these two functions.

- [ ] **Step 1: Add the two keys to the `Dictionary` type's `facilitator` section**

In `src/lib/i18n.ts`, inside the `facilitator: { ... }` type block (starts at line 58), add these two lines directly after the existing `confusion: string;` line (around line 77):

```ts
    confusionLevelSome: (count: number) => string;
    confusionLevelHigh: (count: number) => string;
```

- [ ] **Step 2: Add the English values**

In the `en` object's `facilitator: { ... }` block (starts at line 227), add directly after the existing `confusion: "Possible confusion",` line (around line 246):

```ts
    confusionLevelSome: (count) => `Some confusion (${count})`,
    confusionLevelHigh: (count) => `High confusion (${count})`,
```

- [ ] **Step 3: Add the Chinese values**

In the `zh` object's `facilitator: { ... }` block (starts at line 397), find the existing `confusion: "可能存在困惑",` line and add directly after it:

```ts
    confusionLevelSome: (count) => `一些困惑 (${count})`,
    confusionLevelHigh: (count) => `困惑较多 (${count})`,
```

- [ ] **Step 4: Add the Spanish values**

In the `es` object's `facilitator: { ... }` block (starts at line 568), find the existing `confusion: "Posible confusión",` line and add directly after it:

```ts
    confusionLevelSome: (count) => `Algo de confusión (${count})`,
    confusionLevelHigh: (count) => `Mucha confusión (${count})`,
```

- [ ] **Step 5: Verify the project type-checks**

Run: `npx tsc --noEmit`
Expected: no new errors. If the `Dictionary` type is missing the new keys on any locale object, TypeScript will report a missing-property error on that locale object — fix until clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/i18n.ts
git commit -m "Add confusion-level dict entries for en/zh/es"
```

---

### Task 3: Wire the badge into the facilitator dashboard

**Files:**
- Modify: `src/app/sessions/[sessionId]/facilitator/page.tsx`

**Interfaces:**
- Consumes: `computeConfusionLevel` and `ConfusionLevel` from `@/lib/confusion-level` (Task 1); `dict.confusionLevelSome`/`dict.confusionLevelHigh` from the facilitator dict (Task 2). Also reads the already-fetched `session.insights` array (existing, `type: InsightType`, `createdAt: Date`, from the Prisma query at `page.tsx:73-77`).
- Produces: no new exports — this is a leaf UI change. Nothing downstream depends on it.

- [ ] **Step 1: Import `computeConfusionLevel`**

In `src/app/sessions/[sessionId]/facilitator/page.tsx`, add to the imports near the other `@/lib/*` imports (around line 23, next to the `session-contracts` import):

```ts
import { computeConfusionLevel } from "@/lib/confusion-level";
```

- [ ] **Step 2: Compute the confusion level from `session.insights`**

After the `if (!session) notFound();` / retention check block (around line 108, right before `const lang = resolveLanguage(...)` at line 110), add:

```ts
  const confusionTimestamps = session.insights
    .filter((item) => item.type === "CONFUSION")
    .map((item) => item.createdAt);
  const confusionLevel = computeConfusionLevel(confusionTimestamps, new Date());
```

- [ ] **Step 3: Render the badge next to the "Act now" heading**

Find the "Act now" section header (around line 284-287):

```tsx
      <section className="flex flex-col gap-3" aria-live="polite">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-data text-xs font-medium uppercase tracking-wider text-muted-foreground">{dict.actNow}</h2>
        </div>
```

Replace the `<h2>` line with a wrapping flex container that adds the conditional badge:

```tsx
      <section className="flex flex-col gap-3" aria-live="polite">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="font-data text-xs font-medium uppercase tracking-wider text-muted-foreground">{dict.actNow}</h2>
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

Note: `--tick-low` is the same token used for the BLOCKER card accent (line 311, `dict.blocker` case) and `--tick-medium` matches the CONFUSION card accent — i.e. HIGH-confusion badge = same red-ish tone as a Blocker card, SOME-confusion badge = same tone as an individual Confusion card. This is intentional: the badge's color language should read as "more of the same severity language already on this page," not a new palette.

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`, open a session's facilitator dashboard in the browser.

- With no CONFUSION insights yet: confirm no badge renders next to "Act now" (matches the CALM/hidden behavior).
- This page requires live insight generation (`INSIGHT_MODEL_API_KEY` configured) to produce real CONFUSION insights during a live session — if that's not configured locally, instead verify via a quick temporary console.log of `confusionTimestamps`/`confusionLevel` right after Step 2's code, confirming the shape is as expected, then remove the log before committing. Do not commit a `console.log`.

- [ ] **Step 6: Commit**

```bash
git add src/app/sessions/[sessionId]/facilitator/page.tsx
git commit -m "Show group confusion level badge in facilitator Act now header"
```

---

### Task 4: Full test suite regression check

**Files:** none (verification-only task).

**Interfaces:** none.

- [ ] **Step 1: Run the full unit/component test suite**

Run: `npm test`
Expected: PASS — all existing tests plus the new `confusion-level.test.ts` suite green, no regressions in `facilitator`-adjacent tests (there is no existing `page.test.tsx` for this Server Component, so no snapshot to update).

- [ ] **Step 2: Run the full type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Confirm no leftover debug code**

Run: `git diff main -- src/app/sessions/[sessionId]/facilitator/page.tsx | grep -n "console.log"`
Expected: no output. If Task 3 Step 5's temporary debug log was left in, remove it now and commit the removal.
