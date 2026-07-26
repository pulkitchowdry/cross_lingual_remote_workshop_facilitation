# Facilitator Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give facilitators a collapsible analytics drawer on the facilitator dashboard showing confusion trend, participation breakdown, blocker/decision resolution, and language/translation stats — live during a session and frozen as a report once it ends.

**Architecture:** One new pure aggregation module (`src/lib/facilitator-analytics.ts`) computes a `FacilitatorAnalytics` object from data the facilitator page already fetches (or a few small additive queries alongside it). A new client component (`AnalyticsDrawer`) renders it as a collapsible sidebar. No new API route and no new polling: the page is a Server Component and the existing `SessionAutoRefresh` component already re-runs it via `router.refresh()` every 2s while LIVE, so a fresh `FacilitatorAnalytics` is simply recomputed and passed down as a prop on every refresh — the same mechanism that already keeps the confusion badges live.

**Tech Stack:** Next.js App Router (Server Components), Prisma, TypeScript, Vitest, Tailwind (existing design tokens/`Card` component), existing `i18n.ts` dictionary system (en/zh/es).

## Global Constraints

- Reuse `DEFAULT_WINDOW_MS` (10 min) from `src/lib/confusion-level.ts` for the confusion-trend bucketing — do not invent a second hardcoded window.
- No new DB writes, no new ML/sentiment signal — confusion detection already exists (`confusion-level.ts`/`learner-confusion.ts`); analytics only aggregates existing `Insight`/`Message`/`SessionParticipant`/`TranscriptSegment`/`Translation` rows.
- Follow the existing provider-pattern-free, plain-Prisma-query style used in `facilitator/page.tsx` — no new abstraction layer.
- All new user-facing strings go through `src/lib/i18n.ts`'s `facilitator` dictionary (en, zh, es) — no hardcoded English in JSX.
- Colocate Vitest tests next to source (`facilitator-analytics.test.ts` beside `facilitator-analytics.ts`), matching `confusion-level.test.ts`'s style (fixed `NOW` date, `minutesAgo` helper).
- Per user instruction: implement, raise a PR and a GitHub issue, include a screenshot and a mermaid diagram in the PR description, avoid merge conflicts with other in-flight work, do not merge to `main` without explicit approval.

---

### Task 1: `facilitator-analytics.ts` aggregation module + tests

**Files:**
- Create: `src/lib/facilitator-analytics.ts`
- Test: `src/lib/facilitator-analytics.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ConfusionTrendPoint {
    bucketStart: Date;
    groupLevel: "CALM" | "SOME" | "HIGH";
    count: number;
  }

  export interface ParticipationEntry {
    userId: string;
    displayName: string;
    messageCount: number;
    questionCount: number;
    isAnonymousAny: boolean;
  }

  export interface BlockerStats {
    raised: number;
    resolved: number;
    open: number;
    avgResolutionMs: number | null;
  }

  export interface LanguageStat {
    language: string;
    translationCount: number;
  }

  export interface FacilitatorAnalytics {
    confusionTrend: ConfusionTrendPoint[];
    participation: ParticipationEntry[];
    blockers: BlockerStats;
    languages: LanguageStat[];
  }

  export function computeConfusionTrend(
    confusionInsightTimestamps: Date[],
    sessionStart: Date,
    now: Date,
    bucketMs?: number, // defaults to DEFAULT_WINDOW_MS from confusion-level.ts
  ): ConfusionTrendPoint[];

  export function computeParticipation(
    messages: { senderId: string; kind: string; isAnonymous: boolean }[],
    participants: { userId: string; displayName: string }[],
  ): ParticipationEntry[];

  export function computeBlockerStats(
    insights: { type: string; status: string; createdAt: Date; resolvedAt: Date | null }[],
  ): BlockerStats;

  export function computeLanguageStats(
    translations: { targetLanguage: string }[],
  ): LanguageStat[];
  ```
- Consumes: `DEFAULT_WINDOW_MS` from `@/lib/confusion-level` (existing export, no change needed there).

Note on `resolvedAt`: `Insight` has no `resolvedAt` column today (only `status: String @default("ACTIVE")`, values `"ACTIVE"`/`"RESOLVED"` per `resolveInsight` in `facilitator/actions.ts`). `computeBlockerStats` must compute `avgResolutionMs: null` unconditionally in this task (no schema migration in scope) — accept `resolvedAt: Date | null` in the type for forward-compatibility but the caller in Task 2 will always pass `null` for it. Document this with a comment in the file, not a TODO.

- [ ] **Step 1: Write the failing tests for `computeConfusionTrend`**

```ts
// src/lib/facilitator-analytics.test.ts
import { describe, expect, it } from "vitest";
import {
  computeConfusionTrend,
  computeParticipation,
  computeBlockerStats,
  computeLanguageStats,
} from "@/lib/facilitator-analytics";

const NOW = new Date("2026-07-26T12:00:00.000Z");
const SESSION_START = new Date("2026-07-26T11:40:00.000Z"); // 20 min before NOW
const BUCKET_MS = 10 * 60 * 1000;

function minutesAfterStart(minutes: number): Date {
  return new Date(SESSION_START.getTime() + minutes * 60 * 1000);
}

describe("computeConfusionTrend", () => {
  it("returns one CALM bucket per bucketMs-sized window from sessionStart to now, with no data", () => {
    const result = computeConfusionTrend([], SESSION_START, NOW, BUCKET_MS);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ bucketStart: SESSION_START, groupLevel: "CALM", count: 0 });
    expect(result[1]).toEqual({
      bucketStart: new Date(SESSION_START.getTime() + BUCKET_MS),
      groupLevel: "CALM",
      count: 0,
    });
  });

  it("buckets timestamps into the correct window and derives level via existing thresholds", () => {
    const timestamps = [minutesAfterStart(1), minutesAfterStart(2), minutesAfterStart(3)];
    const result = computeConfusionTrend(timestamps, SESSION_START, NOW, BUCKET_MS);
    expect(result[0]).toEqual({ bucketStart: SESSION_START, groupLevel: "HIGH", count: 3 });
    expect(result[1].count).toBe(0);
  });

  it("returns a single bucket when sessionStart equals now", () => {
    const result = computeConfusionTrend([], NOW, NOW, BUCKET_MS);
    expect(result).toEqual([{ bucketStart: NOW, groupLevel: "CALM", count: 0 }]);
  });
});

describe("computeParticipation", () => {
  const participants = [
    { userId: "u1", displayName: "Alice" },
    { userId: "u2", displayName: "Bob" },
  ];

  it("returns zero counts for participants with no messages", () => {
    expect(computeParticipation([], participants)).toEqual([
      { userId: "u1", displayName: "Alice", messageCount: 0, questionCount: 0, isAnonymousAny: false },
      { userId: "u2", displayName: "Bob", messageCount: 0, questionCount: 0, isAnonymousAny: false },
    ]);
  });

  it("counts messages and questions per sender, and flags any anonymous message", () => {
    const messages = [
      { senderId: "u1", kind: "CHAT", isAnonymous: false },
      { senderId: "u1", kind: "QUESTION", isAnonymous: true },
      { senderId: "u2", kind: "CHAT", isAnonymous: false },
    ];
    const result = computeParticipation(messages, participants);
    expect(result.find((r) => r.userId === "u1")).toEqual({
      userId: "u1",
      displayName: "Alice",
      messageCount: 2,
      questionCount: 1,
      isAnonymousAny: true,
    });
    expect(result.find((r) => r.userId === "u2")).toEqual({
      userId: "u2",
      displayName: "Bob",
      messageCount: 1,
      questionCount: 0,
      isAnonymousAny: false,
    });
  });

  it("ignores messages from senders not in the participants list", () => {
    const messages = [{ senderId: "unknown", kind: "CHAT", isAnonymous: false }];
    const result = computeParticipation(messages, participants);
    expect(result.every((r) => r.messageCount === 0)).toBe(true);
  });
});

describe("computeBlockerStats", () => {
  it("returns all zeros and null avgResolutionMs for no insights", () => {
    expect(computeBlockerStats([])).toEqual({ raised: 0, resolved: 0, open: 0, avgResolutionMs: null });
  });

  it("counts only BLOCKER-type insights, splitting ACTIVE vs RESOLVED", () => {
    const insights = [
      { type: "BLOCKER", status: "ACTIVE", createdAt: NOW, resolvedAt: null },
      { type: "BLOCKER", status: "RESOLVED", createdAt: NOW, resolvedAt: null },
      { type: "CONFUSION", status: "ACTIVE", createdAt: NOW, resolvedAt: null },
      { type: "ACTIVITY", status: "ACTIVE", createdAt: NOW, resolvedAt: null },
    ];
    expect(computeBlockerStats(insights)).toEqual({ raised: 2, resolved: 1, open: 1, avgResolutionMs: null });
  });

  it("avgResolutionMs is always null (no resolvedAt column exists yet)", () => {
    const insights = [{ type: "BLOCKER", status: "RESOLVED", createdAt: NOW, resolvedAt: NOW }];
    expect(computeBlockerStats(insights).avgResolutionMs).toBeNull();
  });
});

describe("computeLanguageStats", () => {
  it("returns an empty array for no translations", () => {
    expect(computeLanguageStats([])).toEqual([]);
  });

  it("counts translations per target language, sorted descending by count", () => {
    const translations = [
      { targetLanguage: "zh" },
      { targetLanguage: "es" },
      { targetLanguage: "zh" },
      { targetLanguage: "zh" },
    ];
    expect(computeLanguageStats(translations)).toEqual([
      { language: "zh", translationCount: 3 },
      { language: "es", translationCount: 1 },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/facilitator-analytics.test.ts`
Expected: FAIL with "Cannot find module '@/lib/facilitator-analytics'" (module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/facilitator-analytics.ts
import { DEFAULT_WINDOW_MS } from "@/lib/confusion-level";

export interface ConfusionTrendPoint {
  bucketStart: Date;
  groupLevel: "CALM" | "SOME" | "HIGH";
  count: number;
}

export interface ParticipationEntry {
  userId: string;
  displayName: string;
  messageCount: number;
  questionCount: number;
  isAnonymousAny: boolean;
}

export interface BlockerStats {
  raised: number;
  resolved: number;
  open: number;
  avgResolutionMs: number | null;
}

export interface LanguageStat {
  language: string;
  translationCount: number;
}

export interface FacilitatorAnalytics {
  confusionTrend: ConfusionTrendPoint[];
  participation: ParticipationEntry[];
  blockers: BlockerStats;
  languages: LanguageStat[];
}

function levelForCount(count: number): "CALM" | "SOME" | "HIGH" {
  if (count === 0) return "CALM";
  if (count <= 2) return "SOME";
  return "HIGH";
}

/**
 * Buckets CONFUSION insight timestamps into fixed `bucketMs`-wide windows from
 * `sessionStart` to `now`, reusing the same per-bucket thresholds as
 * computeConfusionLevel (confusion-level.ts) rather than a second scale.
 */
export function computeConfusionTrend(
  confusionInsightTimestamps: Date[],
  sessionStart: Date,
  now: Date,
  bucketMs: number = DEFAULT_WINDOW_MS,
): ConfusionTrendPoint[] {
  const totalMs = Math.max(0, now.getTime() - sessionStart.getTime());
  const bucketCount = Math.floor(totalMs / bucketMs) + 1;
  const buckets: ConfusionTrendPoint[] = Array.from({ length: bucketCount }, (_, i) => ({
    bucketStart: new Date(sessionStart.getTime() + i * bucketMs),
    groupLevel: "CALM" as const,
    count: 0,
  }));

  for (const timestamp of confusionInsightTimestamps) {
    const offset = timestamp.getTime() - sessionStart.getTime();
    if (offset < 0) continue;
    const index = Math.min(bucketCount - 1, Math.floor(offset / bucketMs));
    buckets[index].count += 1;
  }

  return buckets.map((bucket) => ({ ...bucket, groupLevel: levelForCount(bucket.count) }));
}

/** Per-learner message/question totals over the whole session, for every known
 * participant (zero-filled) — not time-windowed, unlike the live confusion badges. */
export function computeParticipation(
  messages: { senderId: string; kind: string; isAnonymous: boolean }[],
  participants: { userId: string; displayName: string }[],
): ParticipationEntry[] {
  const byUser = new Map<string, ParticipationEntry>(
    participants.map((p) => [p.userId, { userId: p.userId, displayName: p.displayName, messageCount: 0, questionCount: 0, isAnonymousAny: false }]),
  );

  for (const message of messages) {
    const entry = byUser.get(message.senderId);
    if (!entry) continue;
    entry.messageCount += 1;
    if (message.kind === "QUESTION") entry.questionCount += 1;
    if (message.isAnonymous) entry.isAnonymousAny = true;
  }

  return Array.from(byUser.values());
}

/**
 * `avgResolutionMs` is always null: Insight has no `resolvedAt` column today
 * (only a plain `status` string set by resolveInsight in facilitator/actions.ts),
 * so time-to-resolution can't be computed yet without a schema change, which is
 * out of scope for this feature.
 */
export function computeBlockerStats(
  insights: { type: string; status: string; createdAt: Date; resolvedAt: Date | null }[],
): BlockerStats {
  const blockerInsights = insights.filter((item) => item.type === "BLOCKER");
  const resolved = blockerInsights.filter((item) => item.status === "RESOLVED").length;
  const raised = blockerInsights.length;
  return { raised, resolved, open: raised - resolved, avgResolutionMs: null };
}

export function computeLanguageStats(translations: { targetLanguage: string }[]): LanguageStat[] {
  const counts = new Map<string, number>();
  for (const translation of translations) {
    counts.set(translation.targetLanguage, (counts.get(translation.targetLanguage) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([language, translationCount]) => ({ language, translationCount }))
    .sort((a, b) => b.translationCount - a.translationCount);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/facilitator-analytics.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/facilitator-analytics.ts src/lib/facilitator-analytics.test.ts
git commit -m "Add facilitator-analytics aggregation module

Pure functions deriving confusion trend, participation, blocker
resolution, and language stats from existing session data — no new
ML signal, no schema change."
```

---

### Task 2: i18n dictionary entries for the analytics drawer

**Files:**
- Modify: `src/lib/i18n.ts`

**Interfaces:**
- Produces: new keys under the `facilitator` dict (type + en + zh + es), consumed by `AnalyticsDrawer` in Task 3:
  ```ts
  analyticsDrawerLabel: string;
  analyticsDrawerOpen: string;
  analyticsDrawerClose: string;
  analyticsConfusionTrendHeading: string;
  analyticsParticipationHeading: string;
  analyticsParticipationRow: (displayName: string, messages: number, questions: number) => string;
  analyticsBlockersHeading: string;
  analyticsBlockersSummary: (raised: number, resolved: number, open: number) => string;
  analyticsLanguagesHeading: string;
  analyticsLanguagesRow: (language: string, count: number) => string;
  analyticsEmptyState: string;
  ```

- [ ] **Step 1: Add the new keys to the `facilitator` type block**

In `src/lib/i18n.ts`, inside the `facilitator: { ... }` type (right after `sessionSummaryMisunderstoodTopics: string;` at line 166), insert:

```ts
    analyticsDrawerLabel: string;
    analyticsDrawerOpen: string;
    analyticsDrawerClose: string;
    analyticsConfusionTrendHeading: string;
    analyticsParticipationHeading: string;
    analyticsParticipationRow: (displayName: string, messages: number, questions: number) => string;
    analyticsBlockersHeading: string;
    analyticsBlockersSummary: (raised: number, resolved: number, open: number) => string;
    analyticsLanguagesHeading: string;
    analyticsLanguagesRow: (language: string, count: number) => string;
    analyticsEmptyState: string;
```

- [ ] **Step 2: Add English values**

Right after the English `sessionSummaryMisunderstoodTopics: "Misunderstood topics",` line (around line 402), insert:

```ts
    analyticsDrawerLabel: "Analytics",
    analyticsDrawerOpen: "Show analytics",
    analyticsDrawerClose: "Hide analytics",
    analyticsConfusionTrendHeading: "Confusion trend",
    analyticsParticipationHeading: "Participation",
    analyticsParticipationRow: (displayName, messages, questions) =>
      `${displayName} · ${messages} messages · ${questions} questions`,
    analyticsBlockersHeading: "Blockers",
    analyticsBlockersSummary: (raised, resolved, open) =>
      `${raised} raised · ${resolved} resolved · ${open} open`,
    analyticsLanguagesHeading: "Languages",
    analyticsLanguagesRow: (language, count) => `${language} · ${count} translations`,
    analyticsEmptyState: "No analytics yet — data will appear as the session progresses.",
```

- [ ] **Step 3: Add Chinese values**

Right after the Chinese `sessionSummaryMisunderstoodTopics: "未理解的主题",` line (around line 623), insert:

```ts
    analyticsDrawerLabel: "数据分析",
    analyticsDrawerOpen: "显示分析",
    analyticsDrawerClose: "隐藏分析",
    analyticsConfusionTrendHeading: "困惑趋势",
    analyticsParticipationHeading: "参与情况",
    analyticsParticipationRow: (displayName, messages, questions) =>
      `${displayName} · ${messages} 条消息 · ${questions} 个问题`,
    analyticsBlockersHeading: "障碍",
    analyticsBlockersSummary: (raised, resolved, open) =>
      `提出 ${raised} · 已解决 ${resolved} · 未解决 ${open}`,
    analyticsLanguagesHeading: "语言",
    analyticsLanguagesRow: (language, count) => `${language} · ${count} 次翻译`,
    analyticsEmptyState: "暂无分析数据——数据将随会话进行而出现。",
```

- [ ] **Step 4: Add Spanish values**

Right after the Spanish `sessionSummaryMisunderstoodTopics: "Temas no comprendidos",` line (around line 844), insert:

```ts
    analyticsDrawerLabel: "Analítica",
    analyticsDrawerOpen: "Mostrar analítica",
    analyticsDrawerClose: "Ocultar analítica",
    analyticsConfusionTrendHeading: "Tendencia de confusión",
    analyticsParticipationHeading: "Participación",
    analyticsParticipationRow: (displayName, messages, questions) =>
      `${displayName} · ${messages} mensajes · ${questions} preguntas`,
    analyticsBlockersHeading: "Bloqueos",
    analyticsBlockersSummary: (raised, resolved, open) =>
      `${raised} planteados · ${resolved} resueltos · ${open} abiertos`,
    analyticsLanguagesHeading: "Idiomas",
    analyticsLanguagesRow: (language, count) => `${language} · ${count} traducciones`,
    analyticsEmptyState: "Aún no hay analítica — los datos aparecerán a medida que avance la sesión.",
```

- [ ] **Step 5: Verify the project typechecks**

Run: `npx tsc --noEmit`
Expected: no new errors (confirms all three locale objects satisfy the updated `facilitator` type).

- [ ] **Step 6: Commit**

```bash
git add src/lib/i18n.ts
git commit -m "Add i18n strings for facilitator analytics drawer (en/zh/es)"
```

---

### Task 3: `AnalyticsDrawer` component

**Files:**
- Create: `src/components/AnalyticsDrawer.tsx`

**Interfaces:**
- Consumes: `FacilitatorAnalytics` type from `@/lib/facilitator-analytics` (Task 1); `facilitator` dict slice from `@/lib/i18n` (Task 2, use `Dictionary["facilitator"]` type already exported by `i18n.ts` — check the existing `Dictionary` export name before importing; it is used as `getDictionary(lang).facilitator` throughout `facilitator/page.tsx`).
- Produces: `AnalyticsDrawer` React component, default-closed, rendered inside `facilitator/page.tsx` (Task 4).

```tsx
"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import type { FacilitatorAnalytics } from "@/lib/facilitator-analytics";

export function AnalyticsDrawer({
  analytics,
  isFrozen,
  dict,
}: {
  analytics: FacilitatorAnalytics;
  isFrozen: boolean;
  dict: {
    analyticsDrawerLabel: string;
    analyticsDrawerOpen: string;
    analyticsDrawerClose: string;
    analyticsConfusionTrendHeading: string;
    analyticsParticipationHeading: string;
    analyticsParticipationRow: (displayName: string, messages: number, questions: number) => string;
    analyticsBlockersHeading: string;
    analyticsBlockersSummary: (raised: number, resolved: number, open: number) => string;
    analyticsLanguagesHeading: string;
    analyticsLanguagesRow: (language: string, count: number) => string;
    analyticsEmptyState: string;
  };
}) {
  const [isOpen, setIsOpen] = useState(false);
  const isEmpty =
    analytics.confusionTrend.every((point) => point.count === 0) &&
    analytics.participation.every((entry) => entry.messageCount === 0) &&
    analytics.blockers.raised === 0 &&
    analytics.languages.length === 0;

  return (
    <aside className="flex flex-col gap-2" aria-label={dict.analyticsDrawerLabel}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        className="font-data w-fit rounded-md border border-border-strong px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-foreground hover:border-[var(--tick-high)] hover:text-[var(--tick-high)]"
      >
        {isOpen ? dict.analyticsDrawerClose : dict.analyticsDrawerOpen}
      </button>
      {isOpen && (
        <div className="flex flex-col gap-3">
          {isEmpty ? (
            <Card>
              <p className="text-muted-foreground">{dict.analyticsEmptyState}</p>
            </Card>
          ) : (
            <>
              <Card eyebrow={dict.analyticsConfusionTrendHeading}>
                <div className="flex items-end gap-1" aria-hidden="true">
                  {analytics.confusionTrend.map((point) => (
                    <div
                      key={point.bucketStart.toISOString()}
                      className="w-3 rounded-sm"
                      style={{
                        height: `${4 + point.count * 6}px`,
                        backgroundColor:
                          point.groupLevel === "HIGH"
                            ? "var(--tick-low)"
                            : point.groupLevel === "SOME"
                              ? "var(--tick-medium)"
                              : "var(--tick-high)",
                      }}
                    />
                  ))}
                </div>
              </Card>
              <Card eyebrow={dict.analyticsParticipationHeading}>
                <ul className="flex flex-col gap-1">
                  {analytics.participation.map((entry) => (
                    <li key={entry.userId} className="text-xs">
                      {dict.analyticsParticipationRow(entry.displayName, entry.messageCount, entry.questionCount)}
                    </li>
                  ))}
                </ul>
              </Card>
              <Card eyebrow={dict.analyticsBlockersHeading}>
                <p className="text-xs">
                  {dict.analyticsBlockersSummary(analytics.blockers.raised, analytics.blockers.resolved, analytics.blockers.open)}
                </p>
              </Card>
              {analytics.languages.length > 0 && (
                <Card eyebrow={dict.analyticsLanguagesHeading}>
                  <ul className="flex flex-col gap-1">
                    {analytics.languages.map((entry) => (
                      <li key={entry.language} className="text-xs">
                        {dict.analyticsLanguagesRow(entry.language, entry.translationCount)}
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </>
          )}
          {isFrozen && (
            <p className="font-data text-[10px] uppercase tracking-wider text-muted-foreground">
              {/* Frozen (post-session) analytics — reuses the same drawer, no separate report artifact, per design doc. */}
            </p>
          )}
        </div>
      )}
    </aside>
  );
}
```

- [ ] **Step 1: Create the component file**

Create `src/components/AnalyticsDrawer.tsx` with the exact content above.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors referencing `AnalyticsDrawer.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/AnalyticsDrawer.tsx
git commit -m "Add AnalyticsDrawer component for facilitator analytics"
```

---

### Task 4: Wire analytics into the facilitator page

**Files:**
- Modify: `src/app/sessions/[sessionId]/facilitator/page.tsx`

**Interfaces:**
- Consumes: `computeConfusionTrend`, `computeParticipation`, `computeBlockerStats`, `computeLanguageStats` from `@/lib/facilitator-analytics` (Task 1); `AnalyticsDrawer` from `@/components/AnalyticsDrawer` (Task 3).

- [ ] **Step 1: Add two additive queries to the existing `Promise.all` data-fetch**

In `facilitator/page.tsx`, the `Promise.all` currently fetches `[session, activeActionItems, recentConfusionInsights, recentLearnerQuestions, messageCount, questionCount]` (lines 75-144). Add two more entries — a full-session (not time-windowed) `BLOCKER`+`CONFUSION`-type insight list for `computeBlockerStats`, and the session's messages with `kind`/`isAnonymous`/`senderId` for `computeParticipation` (reuse `session.messages` already fetched instead of a new query — it's capped at `MESSAGE_HISTORY_LIMIT`, which is fine for participation *ordering* concerns already accepted elsewhere in this file, but participation totals should use the same plain `prisma.message.findMany` unbounded-by-type approach as `messageCount`/`questionCount` above to avoid the cap silently undercounting on long sessions):

```ts
    prisma.insight.findMany({
      where: { sessionId, type: "BLOCKER" },
      select: { status: true, createdAt: true },
    }),
    prisma.message.findMany({
      where: { sessionId },
      select: { senderId: true, kind: true, isAnonymous: true },
    }),
```

Name the two new destructured results `allBlockerInsights` and `allMessagesForParticipation`.

- [ ] **Step 2: Compute `FacilitatorAnalytics` after the existing confusion computations**

Right after the existing `const learnerConfusionLevels = ...` block (around line 165), add:

```ts
  const analytics: FacilitatorAnalytics = {
    confusionTrend: computeConfusionTrend(
      confusionTimestamps,
      session.startedAt ?? session.createdAt,
      new Date(),
    ),
    participation: computeParticipation(
      allMessagesForParticipation,
      session.participants.map((p) => ({ userId: p.userId, displayName: p.user.displayName })),
    ),
    blockers: computeBlockerStats(
      allBlockerInsights.map((item) => ({ ...item, type: "BLOCKER", resolvedAt: null })),
    ),
    languages: computeLanguageStats(
      session.transcript.flatMap((segment) => segment.translations.map((t) => ({ targetLanguage: t.targetLanguage }))),
    ),
  };
```

- [ ] **Step 3: Add the two new imports**

At the top of the file, alongside the existing `computeConfusionLevel`/`computeLearnerConfusionLevels` imports:

```ts
import {
  computeConfusionTrend,
  computeParticipation,
  computeBlockerStats,
  computeLanguageStats,
  type FacilitatorAnalytics,
} from "@/lib/facilitator-analytics";
import { AnalyticsDrawer } from "@/components/AnalyticsDrawer";
```

- [ ] **Step 4: Render `AnalyticsDrawer` in both the LIVE and ENDED sections**

Inside the existing `{session.status === SessionStatus.LIVE && (...)}` section (around line 316), add `<AnalyticsDrawer analytics={analytics} isFrozen={false} dict={dict} />` right before the closing `</section>`.

Inside the existing `{session.status === SessionStatus.ENDED && (...)}` section (around line 386), add `<AnalyticsDrawer analytics={analytics} isFrozen={true} dict={dict} />` right after the existing `sessionSummary` `<Card>` block and before the `<SessionSidePanel>` call.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Lint**

Run: `npm run lint` (check `package.json` for the exact script name first; use whatever `src/AGENTS.md`/`package.json` defines)
Expected: no new lint errors in the modified/created files.

- [ ] **Step 7: Run the full unit test suite**

Run: `npx vitest run`
Expected: all tests pass, including the new `facilitator-analytics.test.ts`.

- [ ] **Step 8: Manual verification via the `/run` skill**

Use the `/run` skill to start the app, open a session as facilitator, start it (LIVE), send a few chat messages/questions from a learner tab, and confirm:
- The "Show analytics" button appears and toggles the drawer
- Confusion trend bars, participation rows, and blocker summary populate and update on each 2s auto-refresh
- Ending the session freezes the drawer's content (no more updates) without errors

- [ ] **Step 9: Commit**

```bash
git add src/app/sessions/[sessionId]/facilitator/page.tsx
git commit -m "Wire AnalyticsDrawer into facilitator dashboard (live + post-session)"
```

---

### Task 5: Raise the GitHub issue and PR

**Files:** none (process task)

- [ ] **Step 1: Create the GitHub issue**

```bash
gh issue create --title "Add facilitator analytics (confusion trend, participation, blockers, languages)" --body "$(cat <<'EOF'
## Summary
Status item 9: facilitators currently see confusion badges and a basic
post-session summary, but no dedicated analytics view. This adds a
collapsible analytics drawer (confusion trend, participation breakdown,
blocker resolution, language/translation stats) live during a session and
frozen as a report after it ends.

See design: docs/superpowers/specs/2026-07-26-facilitator-analytics-design.md
See plan: docs/superpowers/plans/2026-07-26-facilitator-analytics.md
EOF
)"
```

Note the returned issue number for the PR body below.

- [ ] **Step 2: Push the branch and open the PR**

```bash
git push -u origin HEAD
gh pr create --title "Add facilitator analytics drawer" --body "$(cat <<'EOF'
## Summary
- Adds `facilitator-analytics.ts`: pure aggregation of confusion trend,
  participation, blocker resolution, and language/translation stats from
  existing session data (no new ML signal, no schema change).
- Adds `AnalyticsDrawer`, a collapsible sidebar on the facilitator dashboard,
  live during LIVE sessions (via the existing 2s `SessionAutoRefresh` poll)
  and frozen post-session.
- New i18n strings (en/zh/es).

Closes #<issue-number>

## Architecture

\`\`\`mermaid
flowchart LR
  A[facilitator/page.tsx] -->|fetches Insight/Message/Participant/Transcript| B[facilitator-analytics.ts]
  B -->|FacilitatorAnalytics| C[AnalyticsDrawer]
  D[SessionAutoRefresh] -->|router.refresh every 2s| A
\`\`\`

## Screenshot
<!-- attach a screenshot of the open drawer during a LIVE session here -->

## Test plan
- [ ] `npx vitest run` passes, including new `facilitator-analytics.test.ts`
- [ ] `npx tsc --noEmit` passes
- [ ] Manually verified via `/run`: drawer opens/closes, updates live, freezes post-session
EOF
)"
```

- [ ] **Step 3: Attach a screenshot**

Take a screenshot of the open drawer during a LIVE session (via the `/run` skill's browser tooling or manual browser) and attach it to the PR description in place of the placeholder comment above.

Do NOT merge the PR — leave it open for review, per repo convention and the user's explicit "no merge conflicts, no merge" instruction.
