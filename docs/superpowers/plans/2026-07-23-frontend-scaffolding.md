# Frontend Scaffolding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold four mock-data Next.js pages (`/setup`, `/dashboard`, `/learner`, `/history`) plus shared components, matching the combined Live Status Dashboard + Trustworthy Translation approach, then raise GitHub issues, open a PR, and attach Mermaid diagrams and screenshots.

**Architecture:** Next.js 16 App Router, Server Components by default with `'use client'` only on interactive pieces (setup form, dashboard reply box). Shared presentational components in `src/components/` take typed mock data via props so a later data-wiring pass is a prop-source swap, not a rewrite. No backend, no tests-as-code framework exists in this repo — verification is `npm run lint`, `npm run build`, and manual dev-server/browser checks.

**Tech Stack:** Next.js 16.2.11, React 19.2.4, TypeScript, Tailwind CSS v4, ESLint 9.

## Global Constraints

- No backend/API route handlers in this pass (spec: "Out of scope").
- No auth, persistence, or multi-session state (spec: "Out of scope").
- Server Components by default; `'use client'` only where interactivity is needed (spec: "Next.js 16 conventions").
- Use `next/link` for all internal navigation (spec: "Next.js 16 conventions").
- Every AI-style claim in the dashboard UI must show a translated quote and, where applicable, a confidence badge (spec: "Trustworthy Translation" combo requirement).
- Follow existing repo conventions: Tailwind utility classes, dark-mode variants (`dark:`), Geist font already wired in `src/app/layout.tsx`.

---

### Task 1: Shared types and mock data

**Files:**
- Create: `src/lib/mock-data.ts`
- Create: `src/lib/types.ts`

**Interfaces:**
- Produces: `TranscriptEntry { id: string; speaker: string; original: string; translation: string; confidence: "high" | "medium" | "low"; hasPreservedSpan: boolean }`
- Produces: `Blocker { id: string; summary: string; quoteId: string }`
- Produces: `Decision { id: string; summary: string; quoteId: string }`
- Produces: `SessionSummary { id: string; timestamp: string; activity: string; decisions: string[]; blockers: string[] }`
- Produces: mock arrays `mockTranscript: TranscriptEntry[]`, `mockBlockers: Blocker[]`, `mockDecisions: Decision[]`, `mockGoal: string`, `mockCurrentActivity: string`, `mockHistory: SessionSummary[]`

- [ ] **Step 1: Write `src/lib/types.ts`**

```typescript
export type Confidence = "high" | "medium" | "low";

export interface TranscriptEntry {
  id: string;
  speaker: string;
  original: string;
  translation: string;
  confidence: Confidence;
  hasPreservedSpan: boolean;
}

export interface Blocker {
  id: string;
  summary: string;
  quoteId: string;
}

export interface Decision {
  id: string;
  summary: string;
  quoteId: string;
}

export interface SessionSummary {
  id: string;
  timestamp: string;
  activity: string;
  decisions: string[];
  blockers: string[];
}
```

- [ ] **Step 2: Write `src/lib/mock-data.ts`**

```typescript
import type { Blocker, Decision, SessionSummary, TranscriptEntry } from "./types";

export const mockGoal =
  "Implement a working REST endpoint for user signup, including input validation.";

export const mockCurrentActivity =
  "Debugging a 500 error thrown when the email field is empty.";

export const mockTranscript: TranscriptEntry[] = [
  {
    id: "t1",
    speaker: "Learner A",
    original: "如果 email 是空的，会报 500 错误。",
    translation: "If the email is empty, it throws a 500 error.",
    confidence: "high",
    hasPreservedSpan: false,
  },
  {
    id: "t2",
    speaker: "Learner B",
    original: "我们试着加了 if (!req.body.email) return res.status(400)，但还是报错。",
    translation:
      "We tried adding if (!req.body.email) return res.status(400), but it still errors.",
    confidence: "medium",
    hasPreservedSpan: true,
  },
  {
    id: "t3",
    speaker: "Learner A",
    original: "可能是 validateEmail() 函数本身抛出了异常。",
    translation: "It might be that the validateEmail() function itself is throwing.",
    confidence: "low",
    hasPreservedSpan: true,
  },
];

export const mockDecisions: Decision[] = [
  {
    id: "d1",
    summary: "Added an early return for a missing email field.",
    quoteId: "t2",
  },
];

export const mockBlockers: Blocker[] = [
  {
    id: "b1",
    summary: "Unclear whether validateEmail() throws on empty input.",
    quoteId: "t3",
  },
];

export const mockHistory: SessionSummary[] = [
  {
    id: "h1",
    timestamp: "10:02 AM",
    activity: "Setting up the Express route and request body parsing.",
    decisions: ["Use express.json() middleware for body parsing."],
    blockers: [],
  },
  {
    id: "h2",
    timestamp: "10:14 AM",
    activity: "Debugging a 500 error thrown when the email field is empty.",
    decisions: ["Added an early return for a missing email field."],
    blockers: ["Unclear whether validateEmail() throws on empty input."],
  },
];
```

- [ ] **Step 3: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no errors referencing `src/lib/types.ts` or `src/lib/mock-data.ts`

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts src/lib/mock-data.ts
git commit -m "Add shared types and mock data for facilitator UI scaffolding"
```

---

### Task 2: TranscriptEntry and SummaryCard components

**Files:**
- Create: `src/components/TranscriptEntryView.tsx`
- Create: `src/components/SummaryCard.tsx`

**Interfaces:**
- Consumes: `TranscriptEntry`, `SessionSummary` from `src/lib/types.ts` (Task 1)
- Produces: `TranscriptEntryView({ entry: TranscriptEntry })` — renders speaker, original quote, translation, confidence badge, and a visual marker when `hasPreservedSpan` is true
- Produces: `SummaryCard({ summary: SessionSummary })` — renders timestamp, activity, decisions list, blockers list

- [ ] **Step 1: Write `src/components/TranscriptEntryView.tsx`**

```tsx
import type { TranscriptEntry } from "@/lib/types";

const confidenceStyles: Record<TranscriptEntry["confidence"], string> = {
  high: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  low: "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200",
};

export function TranscriptEntryView({ entry }: { entry: TranscriptEntry }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-black/10 p-3 dark:border-white/10">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{entry.speaker}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${confidenceStyles[entry.confidence]}`}
        >
          {entry.confidence} confidence
        </span>
      </div>
      <p className="text-sm text-zinc-500 dark:text-zinc-400" lang="und">
        {entry.original}
      </p>
      <p className="text-sm">
        {entry.translation}
        {entry.hasPreservedSpan && (
          <span className="ml-2 rounded bg-zinc-200 px-1.5 py-0.5 font-mono text-xs dark:bg-zinc-800">
            code/jargon preserved
          </span>
        )}
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Write `src/components/SummaryCard.tsx`**

```tsx
import type { SessionSummary } from "@/lib/types";

export function SummaryCard({ summary }: { summary: SessionSummary }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-black/10 p-4 dark:border-white/10">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{summary.activity}</h3>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{summary.timestamp}</span>
      </div>
      {summary.decisions.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
            Decisions
          </p>
          <ul className="list-disc pl-5 text-sm">
            {summary.decisions.map((decision) => (
              <li key={decision}>{decision}</li>
            ))}
          </ul>
        </div>
      )}
      {summary.blockers.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
            Blockers
          </p>
          <ul className="list-disc pl-5 text-sm">
            {summary.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no errors referencing these two files

- [ ] **Step 4: Commit**

```bash
git add src/components/TranscriptEntryView.tsx src/components/SummaryCard.tsx
git commit -m "Add TranscriptEntryView and SummaryCard components"
```

---

### Task 3: AppShell navigation component

**Files:**
- Create: `src/components/AppShell.tsx`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Produces: `AppShell({ children: React.ReactNode })` — renders a top nav with links to `/setup`, `/dashboard`, `/learner`, `/history`, wrapping `children`
- Consumes: nothing beyond `next/link`

- [ ] **Step 1: Write `src/components/AppShell.tsx`**

```tsx
import Link from "next/link";

const NAV_LINKS = [
  { href: "/setup", label: "Setup" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/learner", label: "Learner View" },
  { href: "/history", label: "History" },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-black/10 dark:border-white/10">
        <nav className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-4">
          <span className="font-semibold">Interlingo</span>
          <ul className="flex gap-4 text-sm">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="hover:underline">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: Modify `src/app/layout.tsx` to use `AppShell`**

Replace the `<body>` line:

```tsx
      <body className="min-h-full flex flex-col">{children}</body>
```

with:

```tsx
      <body className="min-h-full flex flex-col">
        <AppShell>{children}</AppShell>
      </body>
```

And add the import near the top with the other imports:

```tsx
import { AppShell } from "@/components/AppShell";
```

- [ ] **Step 3: Verify it typechecks and lints**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/components/AppShell.tsx src/app/layout.tsx
git commit -m "Add AppShell navigation shared across all pages"
```

---

### Task 4: `/setup` page

**Files:**
- Create: `src/app/setup/page.tsx`
- Create: `src/components/SetupForm.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks except `AppShell` (already applied globally via layout)
- Produces: `SetupForm` (Client Component) — controlled form with a goal textarea; on submit (mock-only), shows a confirmation message, no navigation/side effects

- [ ] **Step 1: Write `src/components/SetupForm.tsx`**

```tsx
"use client";

import { useState } from "react";

export function SetupForm() {
  const [goal, setGoal] = useState("");
  const [submitted, setSubmitted] = useState(false);

  return (
    <form
      className="flex max-w-xl flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
      }}
    >
      <label className="flex flex-col gap-2 text-sm font-medium">
        Workshop goal
        <textarea
          className="rounded-lg border border-black/10 p-3 text-sm dark:border-white/10 dark:bg-black"
          rows={4}
          required
          value={goal}
          onChange={(event) => {
            setGoal(event.target.value);
            setSubmitted(false);
          }}
          placeholder="e.g. Implement a working REST endpoint for user signup, including input validation."
        />
      </label>
      <button
        type="submit"
        className="w-fit rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
      >
        Start session
      </button>
      {submitted && (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">
          Goal set. The facilitator dashboard will track progress against: &ldquo;{goal}&rdquo;
        </p>
      )}
    </form>
  );
}
```

- [ ] **Step 2: Write `src/app/setup/page.tsx`**

```tsx
import { SetupForm } from "@/components/SetupForm";

export default function SetupPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Session setup</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Set the workshop goal once, before the session starts. The dashboard uses this to
          judge whether the group&apos;s discussion is on track.
        </p>
      </div>
      <SetupForm />
    </div>
  );
}
```

- [ ] **Step 3: Verify it typechecks and lints**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/app/setup/page.tsx src/components/SetupForm.tsx
git commit -m "Scaffold /setup page"
```

---

### Task 5: `/dashboard` page

**Files:**
- Create: `src/app/dashboard/page.tsx`
- Create: `src/components/DashboardPanel.tsx`
- Create: `src/components/ReplyBox.tsx`

**Interfaces:**
- Consumes: `TranscriptEntry`, `Blocker`, `Decision` types + `mockGoal`, `mockCurrentActivity`, `mockTranscript`, `mockDecisions`, `mockBlockers` (Task 1); `TranscriptEntryView` (Task 2)
- Produces: `DashboardPanel({ title: string; children: React.ReactNode })` — a generic titled panel wrapper used for Goal/Activity/Decisions/Blockers
- Produces: `ReplyBox` (Client Component) — controlled textarea + send button, mock-only (no side effects beyond local state)

- [ ] **Step 1: Write `src/components/DashboardPanel.tsx`**

```tsx
export function DashboardPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-black/10 p-4 dark:border-white/10">
      <h2 className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
        {title}
      </h2>
      <div className="text-sm">{children}</div>
    </section>
  );
}
```

- [ ] **Step 2: Write `src/components/ReplyBox.tsx`**

```tsx
"use client";

import { useState } from "react";

export function ReplyBox() {
  const [reply, setReply] = useState("");
  const [sent, setSent] = useState<string | null>(null);

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        setSent(reply);
        setReply("");
      }}
    >
      <label className="flex flex-col gap-2 text-sm font-medium">
        Reply to the group
        <textarea
          className="rounded-lg border border-black/10 p-3 text-sm dark:border-white/10 dark:bg-black"
          rows={2}
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          placeholder="Type guidance for the group; it will be translated for them."
        />
      </label>
      <button
        type="submit"
        disabled={!reply}
        className="w-fit rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-40 dark:hover:bg-[#ccc]"
      >
        Send translated reply
      </button>
      {sent && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Sent: &ldquo;{sent}&rdquo;</p>
      )}
    </form>
  );
}
```

- [ ] **Step 3: Write `src/app/dashboard/page.tsx`**

```tsx
import { DashboardPanel } from "@/components/DashboardPanel";
import { ReplyBox } from "@/components/ReplyBox";
import { TranscriptEntryView } from "@/components/TranscriptEntryView";
import {
  mockBlockers,
  mockCurrentActivity,
  mockDecisions,
  mockGoal,
  mockTranscript,
} from "@/lib/mock-data";

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Facilitator dashboard</h1>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <DashboardPanel title="Goal">{mockGoal}</DashboardPanel>
        <DashboardPanel title="Current activity">{mockCurrentActivity}</DashboardPanel>
        <DashboardPanel title="Decisions">
          <ul className="list-disc pl-5">
            {mockDecisions.map((decision) => (
              <li key={decision.id}>{decision.summary}</li>
            ))}
          </ul>
        </DashboardPanel>
        <DashboardPanel title="Blockers">
          <ul className="list-disc pl-5">
            {mockBlockers.map((blocker) => (
              <li key={blocker.id}>{blocker.summary}</li>
            ))}
          </ul>
        </DashboardPanel>
      </div>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Transcript</h2>
        <div className="flex flex-col gap-3">
          {mockTranscript.map((entry) => (
            <TranscriptEntryView key={entry.id} entry={entry} />
          ))}
        </div>
      </section>
      <ReplyBox />
    </div>
  );
}
```

- [ ] **Step 4: Verify it typechecks and lints**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/page.tsx src/components/DashboardPanel.tsx src/components/ReplyBox.tsx
git commit -m "Scaffold /dashboard page"
```

---

### Task 6: `/learner` page

**Files:**
- Create: `src/app/learner/page.tsx`

**Interfaces:**
- Consumes: `mockTranscript` (Task 1)

- [ ] **Step 1: Write `src/app/learner/page.tsx`**

```tsx
import { mockTranscript } from "@/lib/mock-data";

export default function LearnerPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Facilitator messages</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          What the remote facilitator has said, in your language and the original.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        {mockTranscript.map((entry) => (
          <div
            key={entry.id}
            className="flex flex-col gap-1 rounded-lg border border-black/10 p-3 dark:border-white/10"
          >
            <span className="text-sm font-semibold">{entry.speaker}</span>
            <p className="text-sm">{entry.translation}</p>
            <p className="text-sm text-zinc-500 dark:text-zinc-400" lang="und">
              {entry.original}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it typechecks and lints**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/app/learner/page.tsx
git commit -m "Scaffold /learner page"
```

---

### Task 7: `/history` page

**Files:**
- Create: `src/app/history/page.tsx`

**Interfaces:**
- Consumes: `mockHistory` (Task 1), `SummaryCard` (Task 2)

- [ ] **Step 1: Write `src/app/history/page.tsx`**

```tsx
import { SummaryCard } from "@/components/SummaryCard";
import { mockHistory } from "@/lib/mock-data";

export default function HistoryPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Session history</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Catch-up summaries for a facilitator joining mid-session or reviewing after.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        {mockHistory.map((summary) => (
          <SummaryCard key={summary.id} summary={summary} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it typechecks and lints**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/app/history/page.tsx
git commit -m "Scaffold /history page"
```

---

### Task 8: Home page redirect and build verification

**Files:**
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: nothing new

- [ ] **Step 1: Replace `src/app/page.tsx` with a redirect to `/setup`**

```tsx
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/setup");
}
```

- [ ] **Step 2: Run the full build**

Run: `npm run build`
Expected: build succeeds, all four routes (`/setup`, `/dashboard`, `/learner`, `/history`) listed in the route summary

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "Redirect home page to /setup"
```

---

### Task 9: Mermaid diagrams

**Files:**
- Create: `docs/frontend-scaffolding-diagrams.md`

- [ ] **Step 1: Write the diagrams file**

```markdown
# Frontend Scaffolding Diagrams

## Page navigation

\`\`\`mermaid
flowchart LR
  Setup["/setup"] --> Dashboard["/dashboard"]
  Dashboard --> Learner["/learner"]
  Dashboard --> History["/history"]
  Learner --> Dashboard
  History --> Dashboard
\`\`\`

## Combined-approach data flow (mock-data scaffolding stage)

\`\`\`mermaid
flowchart TD
  U[Something someone says] --> DET{Looks like code,<br/>a variable, or an error message?}
  DET -->|Yes| PASS[Leave it exactly as-is]
  DET -->|No| TR[Translate it]
  PASS --> ENTRY[TranscriptEntry]
  TR --> CONF[Attach confidence flag]
  CONF --> ENTRY
  ENTRY --> PANEL[Dashboard panels: Goal / Activity / Decisions / Blockers]
  PANEL --> FAC[Facilitator reviews + replies]
  FAC --> LEARNER[Learner view: translated reply]
\`\`\`
```

- [ ] **Step 2: Commit**

```bash
git add docs/frontend-scaffolding-diagrams.md
git commit -m "Add Mermaid diagrams for frontend scaffolding"
```

---

### Task 10: Screenshots, GitHub issues, and PR

**Files:**
- Create: `docs/screenshots/setup.png`, `docs/screenshots/dashboard.png`, `docs/screenshots/learner.png`, `docs/screenshots/history.png` (via browser capture, not hand-written)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (background)

- [ ] **Step 2: Capture a screenshot of each of the four routes**

Navigate to `http://localhost:3000/setup`, `/dashboard`, `/learner`, `/history` and save a
screenshot of each to `docs/screenshots/<route>.png`.

- [ ] **Step 3: Commit screenshots**

```bash
git add docs/screenshots
git commit -m "Add screenshots of scaffolded pages"
```

- [ ] **Step 4: Open one GitHub issue per page/component area**

Run (repeat per issue, titles below):
```bash
gh issue create --title "Wire /setup form to real session state" --body "Scaffolded in PR; currently mock-only. Replace SetupForm's local state with real session creation once backend exists."
gh issue create --title "Wire /dashboard panels and transcript to live data" --body "Scaffolded in PR; currently mock-only. Replace mock-data.ts sources with live STT/translation/summary feed."
gh issue create --title "Wire /learner view to live translated replies" --body "Scaffolded in PR; currently mock-only. Replace mock transcript with live facilitator reply feed."
gh issue create --title "Wire /history to real session summaries" --body "Scaffolded in PR; currently mock-only. Replace mockHistory with persisted catch-up summaries."
```
Expected: four issues created; note their numbers for the PR description.

- [ ] **Step 5: Sync with `main` before opening the PR (avoid merge conflicts)**

```bash
git fetch origin main
git rebase origin/main
```
Expected: rebase completes cleanly (no conflicts, since this is additive scaffolding).

- [ ] **Step 6: Push and open the PR**

```bash
git push -u origin HEAD
gh pr create --title "Scaffold facilitator-focused frontend pages" --body "$(cat <<'EOF'
## Summary
- Scaffolds /setup, /dashboard, /learner, /history with mock data per docs/superpowers/specs/2026-07-23-frontend-scaffolding-design.md
- Adds Mermaid diagrams (docs/frontend-scaffolding-diagrams.md) and page screenshots (docs/screenshots/)
- Follow-up data-wiring tracked in issues #<setup>, #<dashboard>, #<learner>, #<history>

## Test plan
- [x] npx tsc --noEmit
- [x] npm run lint
- [x] npm run build
- [x] Manually viewed all four routes in the browser (see screenshots)
EOF
)"
```
Expected: PR opened against `main`; fill in the actual issue numbers from Step 4 before running.

---

## Self-Review Notes

- Spec coverage: all four pages, shared components, Next.js 16 conventions, diagrams,
  screenshots, issues, and PR are each covered by a task above.
- No placeholders: every step has literal file contents or exact commands.
- Type consistency: `TranscriptEntry`, `Blocker`, `Decision`, `SessionSummary` defined once
  in Task 1 and reused verbatim by name in Tasks 2, 5, 6, 7.
