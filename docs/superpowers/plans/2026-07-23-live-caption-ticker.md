# Live Caption Ticker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Wordly-style auto-scrolling live caption ticker (mock-data driven) to the Learner and Dashboard pages.

**Architecture:** One new client component (`LiveCaptionTicker`) reveals lines from a new `mockLiveCaptionFeed` array one at a time via `setInterval`, auto-scrolling a fixed-height container; user can scroll up to pause and click "Jump to live" to resume. Mounted on both `/learner` and `/dashboard`.

**Tech Stack:** Next.js App Router, TypeScript, React 19 client components, Tailwind CSS v4. No test framework exists in this repo (no jest/vitest configured) — verification is `npm run lint`, `npx tsc --noEmit`, and manual browser check via `npm run dev`.

## Global Constraints

- No backend/WebSocket/real STT/MT integration — mock data only (spec: Non-goals).
- No new route/page — component embeds into existing `/learner` and `/dashboard` pages (spec: Non-goals).
- Reuse `getSpeakerColor`, `ConfidenceTick`, and `Button` — do not fork new color/confidence/button styling (spec: Component, Accessibility & theming).
- `aria-live="polite"`, `aria-atomic="false"` on the scroll region (spec: Component).
- Clean up `setInterval` on unmount (spec: Risks).
- Feed is a manually-interleaved literal array, not a `.sort()` over two arrays (spec: Ordering note).

---

### Task 1: Add `mockLiveCaptionFeed` to mock data

**Files:**
- Modify: `src/lib/mock-data.ts` (append after `mockFacilitatorReplies`, before `mockDecisions`)

**Interfaces:**
- Consumes: `TranscriptEntry` type from `./types`, existing `mockTranscript`/`mockFacilitatorReplies` entry objects (reused by reference, not duplicated).
- Produces: `export const mockLiveCaptionFeed: TranscriptEntry[]` — a 5-entry array later tasks import as `import { mockLiveCaptionFeed } from "@/lib/mock-data"`.

- [ ] **Step 1: Add the interleaved feed array**

Insert this block into `src/lib/mock-data.ts` immediately after the `mockFacilitatorReplies` array closes (after its closing `];`):

```ts
export const mockLiveCaptionFeed: TranscriptEntry[] = [
  mockTranscript[0],
  mockTranscript[1],
  mockFacilitatorReplies[0],
  mockTranscript[2],
  mockFacilitatorReplies[1],
];
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors (the array elements are already-typed `TranscriptEntry` objects, so this is a pure type-check pass, not a runtime check).

- [ ] **Step 3: Commit**

```bash
git add src/lib/mock-data.ts
git commit -m "Add interleaved mock live caption feed"
```

---

### Task 2: Build `LiveCaptionTicker` component

**Files:**
- Create: `src/components/LiveCaptionTicker.tsx`

**Interfaces:**
- Consumes: `TranscriptEntry` type (`@/lib/types`), `getSpeakerColor` (`@/lib/speaker-color`), `ConfidenceTick` (`@/components/ui/ConfidenceTick`), `Button` (`@/components/ui/Button`).
- Produces: `export function LiveCaptionTicker({ feed, label }: { feed: TranscriptEntry[]; label?: string })` — default export none, named export only, imported by Task 3 as `import { LiveCaptionTicker } from "@/components/LiveCaptionTicker"`.

- [ ] **Step 1: Check `Button` component's exact prop signature**

Run: `cat src/components/ui/Button.tsx`
Note the exact prop names/types (e.g. `variant`, `size`, `onClick`) so Step 2 uses them correctly — do not guess.

- [ ] **Step 2: Write the component**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfidenceTick } from "@/components/ui/ConfidenceTick";
import { getSpeakerColor } from "@/lib/speaker-color";
import type { TranscriptEntry } from "@/lib/types";

const REVEAL_INTERVAL_MS = 1800;
const SCROLL_BOTTOM_THRESHOLD_PX = 24;

export function LiveCaptionTicker({
  feed,
  label = "Live captions",
}: {
  feed: TranscriptEntry[];
  label?: string;
}) {
  const [revealedCount, setRevealedCount] = useState(feed.length > 0 ? 1 : 0);
  const [isPaused, setIsPaused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (revealedCount >= feed.length) return;
    const id = setInterval(() => {
      setRevealedCount((count) => Math.min(count + 1, feed.length));
    }, REVEAL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [revealedCount, feed.length]);

  useEffect(() => {
    if (isPaused) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [revealedCount, isPaused]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setIsPaused(distanceFromBottom > SCROLL_BOTTOM_THRESHOLD_PX);
  }

  function jumpToLive() {
    setIsPaused(false);
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  const revealed = feed.slice(0, revealedCount);

  return (
    <div className="relative flex flex-col gap-2">
      <h2 className="font-heading text-lg font-semibold">{label}</h2>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        aria-live="polite"
        aria-atomic="false"
        className="flex max-h-56 flex-col gap-2 overflow-y-auto rounded-lg border border-border-subtle bg-surface-raised p-3"
      >
        {revealed.map((entry) => {
          const speakerColor = getSpeakerColor(entry.speaker);
          return (
            <div
              key={entry.id}
              className="flex flex-col gap-1 border-l-2 pl-2"
              style={{ borderColor: speakerColor }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-heading text-xs font-semibold" style={{ color: speakerColor }}>
                  {entry.speaker}
                </span>
                <ConfidenceTick confidence={entry.confidence} />
              </div>
              <p className="text-sm leading-snug text-foreground">{entry.translation}</p>
              <p className="text-xs italic text-muted-foreground" lang="und">
                {entry.original}
              </p>
            </div>
          );
        })}
      </div>
      {isPaused && (
        <Button
          onClick={jumpToLive}
          className="absolute bottom-3 right-3 text-xs"
        >
          Jump to live
        </Button>
      )}
    </div>
  );
}
```

If `Button` (from Step 1) doesn't accept a bare `className` prop or uses a different prop name for variant/size, adjust the `<Button>` call to match its real signature — do not add a new prop to `Button` itself.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/LiveCaptionTicker.tsx
git commit -m "Add LiveCaptionTicker component"
```

---

### Task 3: Mount the ticker on Learner and Dashboard pages

**Files:**
- Modify: `src/app/learner/page.tsx`
- Modify: `src/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `LiveCaptionTicker` from Task 2, `mockLiveCaptionFeed` from Task 1.
- Produces: nothing consumed by later tasks (final integration task).

- [ ] **Step 1: Mount on Learner page**

In `src/app/learner/page.tsx`, add the import:

```tsx
import { LiveCaptionTicker } from "@/components/LiveCaptionTicker";
import { mockFacilitatorReplies, mockLiveCaptionFeed } from "@/lib/mock-data";
```

(replacing the existing single-name `mockFacilitatorReplies` import line with the combined one above), then render the ticker as the first child inside the outer `<div className="flex flex-col gap-6">`, immediately before the existing `<div>` that wraps the "Facilitator messages" heading:

```tsx
<LiveCaptionTicker feed={mockLiveCaptionFeed} label="Live captions" />
```

- [ ] **Step 2: Mount on Dashboard page**

In `src/app/dashboard/page.tsx`, add the import:

```tsx
import { LiveCaptionTicker } from "@/components/LiveCaptionTicker";
```

and add `mockLiveCaptionFeed` to the existing `mock-data` import list, then render the ticker as the first child inside the outer `<div className="flex flex-col gap-6">`, immediately before the existing `<h1>Facilitator dashboard</h1>`:

```tsx
<LiveCaptionTicker feed={mockLiveCaptionFeed} label="Live captions" />
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, open `http://localhost:3000/learner` and `http://localhost:3000/dashboard`.
Expected: ticker box appears at top of each page; a new line appears roughly every 1.8s up to 5 lines; scrolling the ticker box up shows a "Jump to live" button; clicking it scrolls back to bottom and resumes auto-scroll on the next reveal.

- [ ] **Step 5: Capture screenshots**

Save screenshots of both pages (mid-reveal, showing at least 2-3 lines) to `docs/screenshots/live-caption-ticker-learner.png` and `docs/screenshots/live-caption-ticker-dashboard.png` for the PR description.

- [ ] **Step 6: Commit**

```bash
git add src/app/learner/page.tsx src/app/dashboard/page.tsx docs/screenshots/live-caption-ticker-learner.png docs/screenshots/live-caption-ticker-dashboard.png
git commit -m "Mount LiveCaptionTicker on Learner and Dashboard pages"
```

---

## Self-Review

**Spec coverage:** Task 1 covers Data model; Task 2 covers Component (reveal timing, pause/resume, accessibility, styling reuse); Task 3 covers Page integration + Testing/verification (manual check, lint/tsc, screenshots). All spec sections are covered.

**Placeholder scan:** No TBD/TODO; all code blocks are complete; Task 2 Step 1 explicitly instructs checking real `Button` props rather than guessing, to avoid a wrong-signature placeholder.

**Type consistency:** `LiveCaptionTicker({ feed, label })` signature in Task 2 matches the call sites `<LiveCaptionTicker feed={mockLiveCaptionFeed} label="Live captions" />` in Task 3. `mockLiveCaptionFeed: TranscriptEntry[]` in Task 1 matches the `feed: TranscriptEntry[]` prop type in Task 2.
