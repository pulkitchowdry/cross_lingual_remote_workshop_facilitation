# Live Caption Ticker — Design Spec

## Context

`docs/approaches.md` confirms Approach 1 (Live Status Dashboard) as the built direction. Issue #18 tracks wiring the whole frontend to a live STT/MT/LLM backend. This spec adds a **Wordly-style live caption ticker** to the existing mock-data-driven frontend, ahead of and independent from that backend work — it is purely a UI addition that will later read from the same real-time feed #18 introduces.

Wordly's signature feature is a continuously scrolling live-caption strip (original + translated text) that viewers can pause and resume. This spec brings that pattern into this app's Learner and Dashboard views, reusing the existing design system (`Card`, `ConfidenceTick`, `TranscriptEntryView`, speaker colors, dark-mode-default theme).

## Goal

Give both learners and facilitators a live, auto-scrolling caption feed of the whole session (not just facilitator replies or the four dashboard boxes), simulated from mock data with the same chronological reveal illusion a real STT pipeline would produce.

## Non-goals

- No backend, WebSocket, or real STT/MT/LLM integration (owned by #18).
- No new route/page — the ticker is a component embedded in the two existing pages (`/learner`, `/dashboard`).
- No persistence — reveal state resets on page reload/navigation.

## Data model

Add to `src/lib/mock-data.ts`:

```ts
export const mockLiveCaptionFeed: TranscriptEntry[] = [
  ...mockTranscript,
  ...mockFacilitatorReplies,
].sort(/* by existing array position — see Ordering note */);
```

No new type is introduced — `mockLiveCaptionFeed` reuses `TranscriptEntry` from `src/lib/types.ts`.

**Ordering note:** the mock arrays don't carry real timestamps, so the feed is authored as an explicit, manually-interleaved literal array (not a `.sort()` over two arrays) so the conversation reads naturally: learner debugging exchange, then a facilitator reply, continuing to interleave for a realistic feel. This avoids inventing a timestamp field not otherwise used in the codebase.

## Component

`src/components/LiveCaptionTicker.tsx` (new client component, `"use client"`):

- Props: `feed: TranscriptEntry[]`, `label?: string` (e.g. "Live captions").
- State: `revealedCount` (number of feed lines currently shown), `isPaused` (user scrolled away from bottom).
- Behavior:
  - On mount, reveal one additional line every ~1.8s via `setInterval` until the whole feed is shown, then stop (no looping — a finished demo feed, matching how `mockHistory`/`mockTranscript` are static demo data elsewhere).
  - Container is a fixed-height (e.g. `max-h-56`), `overflow-y-auto` scroll region with `aria-live="polite"` and `aria-atomic="false"` so screen readers announce new lines without re-reading the whole feed.
  - Auto-scrolls to bottom on each new reveal, unless `isPaused`.
  - `onScroll` handler: if the user scrolls up more than a small threshold from the bottom, set `isPaused = true` and show a small "Jump to live" pill button (bottom-right, sticky within the container) that on click sets `isPaused = false` and scrolls to bottom.
  - Each revealed line renders using the same visual language as `TranscriptEntryView` but a more compact single-line-oriented variant (speaker name + color bar, translation as primary text, original as small italic subtext, confidence tick) — reuse `getSpeakerColor` and `ConfidenceTick` directly; do not fork a second color/confidence system.

## Page integration

- `src/app/learner/page.tsx`: render `<LiveCaptionTicker feed={mockLiveCaptionFeed} label="Live captions" />` above the existing "Facilitator messages" heading/list.
- `src/app/dashboard/page.tsx`: render the same component above the Goal/Activity/Decisions/Blockers grid, so facilitators see the raw live feed alongside the AI-curated dashboard.

## Accessibility & theming

- `aria-live="polite"` region as above.
- No hard-coded colors beyond existing `getSpeakerColor` / Tailwind theme tokens already used across the app (dark-mode default per `docs/superpowers/specs/2026-07-23-ui-redesign-v2-design.md`).
- "Jump to live" button meets existing `Button` component styling (reuse `src/components/ui/Button.tsx`, do not create a new button style).

## Testing / verification

- Manual: `npm run dev`, visit `/learner` and `/dashboard`, confirm lines reveal progressively, auto-scroll works, scrolling up pauses and shows "Jump to live", clicking it resumes and scrolls to bottom.
- `npm run lint` / `npx tsc --noEmit` (or project's existing type-check script) must pass.
- Screenshots of both pages (ticker mid-reveal) captured for the PR description.

## Risks

- `setInterval`-driven reveal must be cleaned up on unmount (`clearInterval` in `useEffect` cleanup) to avoid state updates after unmount warnings.
- Keep the reveal feed short (existing mock data has ~5 combined entries) so the demo doesn't feel padded; do not fabricate additional filler dialogue beyond a small, clearly-labeled interleaving of the two existing arrays.
