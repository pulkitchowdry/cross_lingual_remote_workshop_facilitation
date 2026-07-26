# Per-Learner Confusion Signal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the facilitator which specific learners appear confused, using existing "Explain simply"/"Give an example" QUESTION messages as the signal, next to the existing group confusion badge.

**Architecture:** A new pure function (`computeLearnerConfusionLevels`) mirrors the existing `computeConfusionLevel` window/threshold logic, but groups by sender instead of session-wide. `facilitator/page.tsx` calls it with data it already fetches (`session.messages`, `session.participants`) and renders a small badge list next to the existing group confusion badge.

**Tech Stack:** TypeScript, Next.js App Router (Server Component), Prisma, Vitest.

## Global Constraints

- Reuse the existing `confusionLevelSome`/`confusionLevelHigh` i18n functions (`src/lib/i18n.ts`) — no new dict keys.
- Same rolling window (10 minutes) and thresholds (1–2 → SOME, 3+ → HIGH) as `computeConfusionLevel` (`src/lib/confusion-level.ts`), for visual/behavioral consistency between the group and per-learner signals.
- No new LLM calls, no schema change, no new e2e coverage (pure derived display, same rationale as the group gauge).
- Full spec: `docs/superpowers/specs/2026-07-26-learner-confusion-signal-design.md`

---

### Task 1: `computeLearnerConfusionLevels` pure function

**Files:**
- Create: `src/lib/learner-confusion.ts`
- Test: `src/lib/learner-confusion.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  ```ts
  export type LearnerConfusionLevel = "SOME" | "HIGH";

  export interface LearnerConfusionEntry {
    userId: string;
    level: LearnerConfusionLevel;
    count: number;
  }

  export function computeLearnerConfusionLevels(
    questionMessages: { senderId: string; sentAt: Date }[],
    learnerUserIds: ReadonlySet<string>,
    now: Date,
    windowMs?: number, // defaults to 10 * 60 * 1000
  ): LearnerConfusionEntry[]
  ```
  Task 2 calls this function and renders its return value.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/learner-confusion.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeLearnerConfusionLevels } from "@/lib/learner-confusion";

const NOW = new Date("2026-07-26T12:00:00.000Z");
const WINDOW_MS = 10 * 60 * 1000;
const LEARNERS = new Set(["learner-a", "learner-b"]);

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
}

describe("computeLearnerConfusionLevels", () => {
  it("returns an empty array for no messages", () => {
    expect(computeLearnerConfusionLevels([], LEARNERS, NOW)).toEqual([]);
  });

  it("returns SOME for a learner with 1 question in the window", () => {
    expect(
      computeLearnerConfusionLevels([{ senderId: "learner-a", sentAt: minutesAgo(2) }], LEARNERS, NOW),
    ).toEqual([{ userId: "learner-a", level: "SOME", count: 1 }]);
  });

  it("returns HIGH for a learner with 3 questions in the window", () => {
    const messages = [
      { senderId: "learner-a", sentAt: minutesAgo(1) },
      { senderId: "learner-a", sentAt: minutesAgo(2) },
      { senderId: "learner-a", sentAt: minutesAgo(3) },
    ];
    expect(computeLearnerConfusionLevels(messages, LEARNERS, NOW)).toEqual([
      { userId: "learner-a", level: "HIGH", count: 3 },
    ]);
  });

  it("returns entries for multiple learners sorted by count descending", () => {
    const messages = [
      { senderId: "learner-a", sentAt: minutesAgo(1) },
      { senderId: "learner-b", sentAt: minutesAgo(1) },
      { senderId: "learner-b", sentAt: minutesAgo(2) },
      { senderId: "learner-b", sentAt: minutesAgo(3) },
    ];
    expect(computeLearnerConfusionLevels(messages, LEARNERS, NOW)).toEqual([
      { userId: "learner-b", level: "HIGH", count: 3 },
      { userId: "learner-a", level: "SOME", count: 1 },
    ]);
  });

  it("excludes messages from a senderId not in learnerUserIds", () => {
    const messages = [
      { senderId: "learner-a", sentAt: minutesAgo(1) },
      { senderId: "facilitator-1", sentAt: minutesAgo(1) },
    ];
    expect(computeLearnerConfusionLevels(messages, LEARNERS, NOW)).toEqual([
      { userId: "learner-a", level: "SOME", count: 1 },
    ]);
  });

  it("includes a message exactly at the window boundary", () => {
    const exactlyAtEdge = new Date(NOW.getTime() - WINDOW_MS);
    expect(
      computeLearnerConfusionLevels([{ senderId: "learner-a", sentAt: exactlyAtEdge }], LEARNERS, NOW),
    ).toEqual([{ userId: "learner-a", level: "SOME", count: 1 }]);
  });

  it("excludes a message just outside the window boundary", () => {
    const justOutside = new Date(NOW.getTime() - WINDOW_MS - 1);
    expect(
      computeLearnerConfusionLevels([{ senderId: "learner-a", sentAt: justOutside }], LEARNERS, NOW),
    ).toEqual([]);
  });

  it("excludes messages in the future relative to now", () => {
    const future = new Date(NOW.getTime() + 60_000);
    expect(computeLearnerConfusionLevels([{ senderId: "learner-a", sentAt: future }], LEARNERS, NOW)).toEqual([]);
  });

  it("respects a custom windowMs override", () => {
    expect(
      computeLearnerConfusionLevels([{ senderId: "learner-a", sentAt: minutesAgo(4) }], LEARNERS, NOW, 3 * 60 * 1000),
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/learner-confusion.test.ts`
Expected: FAIL — `learner-confusion.ts` does not exist / `computeLearnerConfusionLevels` is not defined.

- [ ] **Step 3: Write the implementation**

Create `src/lib/learner-confusion.ts`:

```ts
const DEFAULT_WINDOW_MS = 10 * 60 * 1000;

export type LearnerConfusionLevel = "SOME" | "HIGH";

export interface LearnerConfusionEntry {
  userId: string;
  level: LearnerConfusionLevel;
  count: number;
}

/**
 * Per-learner counterpart to computeConfusionLevel (src/lib/confusion-level.ts):
 * same rolling window and thresholds, but grouped by sender instead of
 * session-wide, over QUESTION messages from CaptionComprehensionActions
 * ("Explain simply" / "Give an example") rather than inferred CONFUSION
 * insights — TranscriptSegment.speakerId can't attribute those to a learner
 * (see design doc), but a learner explicitly asking for clarification can.
 */
export function computeLearnerConfusionLevels(
  questionMessages: { senderId: string; sentAt: Date }[],
  learnerUserIds: ReadonlySet<string>,
  now: Date,
  windowMs: number = DEFAULT_WINDOW_MS,
): LearnerConfusionEntry[] {
  const counts = new Map<string, number>();

  for (const message of questionMessages) {
    if (!learnerUserIds.has(message.senderId)) continue;
    const age = now.getTime() - message.sentAt.getTime();
    if (age < 0 || age > windowMs) continue;
    counts.set(message.senderId, (counts.get(message.senderId) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([userId, count]) => ({ userId, count, level: (count <= 2 ? "SOME" : "HIGH") as LearnerConfusionLevel }))
    .sort((a, b) => b.count - a.count);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/learner-confusion.test.ts`
Expected: PASS (all 9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/learner-confusion.ts src/lib/learner-confusion.test.ts
git commit -m "Add computeLearnerConfusionLevels for per-learner confusion signal"
```

---

### Task 2: Show per-learner confusion badges on the facilitator dashboard

**Files:**
- Modify: `src/app/sessions/[sessionId]/facilitator/page.tsx:117` (add computation near existing `confusionLevel`) and `:293-311` (render badges next to the existing group badge)

**Interfaces:**
- Consumes: `computeLearnerConfusionLevels` and `LearnerConfusionEntry` from `src/lib/learner-confusion.ts` (Task 1).
- Produces: nothing consumed by later tasks — this is the final integration point.

- [ ] **Step 1: Add the import**

In `src/app/sessions/[sessionId]/facilitator/page.tsx`, next to the existing `computeConfusionLevel` import (around line 24):

```ts
import { computeConfusionLevel } from "@/lib/confusion-level";
import { computeLearnerConfusionLevels } from "@/lib/learner-confusion";
```

- [ ] **Step 2: Compute per-learner levels next to the existing group computation**

Immediately after the existing block (around line 112-117):

```ts
  const confusionTimestamps = session.insights
    .filter((item) => item.type === "CONFUSION")
    .map((item) => item.createdAt);
  const confusionLevel = computeConfusionLevel(confusionTimestamps, new Date());
```

add:

```ts
  // session.messages is capped at MESSAGE_HISTORY_LIMIT (see the query above); same
  // truncation tradeoff as confusionTimestamps above — only under-counts once message
  // volume is already high enough to be well past HIGH regardless.
  const learnerUserIds = new Set(session.participants.map((participant) => participant.userId));
  const questionMessages = session.messages
    .filter((message) => message.kind === "QUESTION")
    .map((message) => ({ senderId: message.senderId, sentAt: message.sentAt }));
  const learnerConfusionLevels = computeLearnerConfusionLevels(questionMessages, learnerUserIds, new Date());
  const learnerDisplayNames = new Map(session.participants.map((participant) => [participant.userId, participant]));
```

Note: `session.participants` (queried with `where: { role: ParticipantRole.LEARNER } }`, no `select`) already returns full `SessionParticipant` rows including `userId`, but does **not** include the related `User` (for `displayName`). Update the `participants` query at the top of the file (around line 62) to include it:

```ts
        participants: { where: { role: ParticipantRole.LEARNER }, include: { user: true } },
```

Then fix the `learnerDisplayNames` map above to read the name directly:

```ts
  const learnerDisplayNames = new Map(
    session.participants.map((participant) => [participant.userId, participant.user.displayName]),
  );
```

- [ ] **Step 3: Render the per-learner badges next to the group badge**

In the same file, the existing "Act now" header block (around line 293-311):

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

Replace with (adds a second `flex-wrap` row of per-learner badges, same badge styling as the group one, hidden entirely when `learnerConfusionLevels` is empty):

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
        {learnerConfusionLevels.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {learnerConfusionLevels.map((entry) => {
              const name = learnerDisplayNames.get(entry.userId) ?? commonDict.speaker;
              return (
                <span
                  key={entry.userId}
                  className="font-data rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider"
                  style={{
                    color: entry.level === "HIGH" ? "var(--tick-low)" : "var(--tick-medium)",
                    borderColor: "currentColor",
                  }}
                >
                  {name} ·{" "}
                  {entry.level === "HIGH" ? dict.confusionLevelHigh(entry.count) : dict.confusionLevelSome(entry.count)}
                </span>
              );
            })}
          </div>
        )}
```

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/app/sessions/\[sessionId\]/facilitator/page.tsx`
Expected: no errors.

- [ ] **Step 5: Run the full unit test suite**

Run: `npx vitest run`
Expected: all tests PASS, including the new `learner-confusion.test.ts` from Task 1 and existing `facilitator`-adjacent tests untouched.

- [ ] **Step 6: Manual verification in the browser**

Follow this repo's `run` skill / local dev setup (see `docs/DEPLOYMENT.md`) to start a session as facilitator with two learners. Have one learner click "Explain simply" on a caption 3 times within 10 minutes. Confirm:
- A badge with that learner's display name and "High confusion (3)" appears next to the group badge in "Act now".
- No badge appears if no learner has asked a question recently.
- The facilitator's own use of the QUESTION checkbox in chat does **not** produce a badge for the facilitator.

- [ ] **Step 7: Commit**

```bash
git add src/app/sessions/\[sessionId\]/facilitator/page.tsx
git commit -m "Show per-learner confusion badges on facilitator dashboard"
```
