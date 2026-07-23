# UI/UX Redesign — Design Spec

## Context

The current frontend (`docs/superpowers/specs/2026-07-23-frontend-scaffolding-design.md`) scaffolded four pages (Setup, Dashboard, Learner View, History) with functional but unstyled Tailwind defaults: pure black/white/gray, system font stack, no visual hierarchy, no color coding beyond text labels for confidence levels. Screenshots in `docs/screenshots/` document this baseline.

Goal: raise the visual quality to a "calm data-dashboard" feel (Linear/Vercel-dashboard tone — serious, high-signal, not playful) without changing any page's information architecture or mock data.

## Non-goals

- No new pages, routes, or features.
- No change to `src/lib/mock-data.ts` or `src/lib/types.ts` shapes.
- No component logic changes — this is presentation-layer only (className/markup/tokens).

## Design tokens (new, in `globals.css`)

- Replace the two-variable (`--background`/`--foreground`) theme with a small token set: surface, surface-raised, border, muted-foreground, and an accent scale, plus three semantic confidence colors (high=green, medium=amber, low=red) usable in both light and dark mode via `prefers-color-scheme`.
- Typography: keep system font stack (no new font loading dependency) but define a type scale (page title, section label, body, caption) as reusable utility combinations rather than ad hoc classes repeated per page.
- Replace `font-family: Arial, Helvetica, sans-serif` with the existing unused `--font-sans` (Geist, already wired via `@theme inline` but never applied to `body`).

## Shared primitives (new, `src/components/ui/`)

- `Card.tsx` — replaces the repeated `rounded-* border p-*` div pattern with one component (title slot + content).
- `ConfidenceBadge.tsx` — single source of truth for the high/medium/low confidence pill, replacing inline conditional className strings duplicated across TranscriptEntryView/DashboardPanel/SummaryCard.
- `Button.tsx` — replaces the one-off button classes in SetupForm/ReplyBox.

These are extracted because the same visual pattern (card, confidence pill, button) currently appears independently in 3+ files with slightly different Tailwind strings — a change to the design language would otherwise require editing every occurrence.

## Shell / navigation (`AppShell.tsx`)

- Keep the same 4 links and single-row header structure (no IA change), but give it a visual identity: accent-colored active-link state, slightly stronger header separation (shadow instead of a single hairline), consistent max-width with page content.

## Pages

Each page keeps its exact current content/copy/data, restyled using the shared primitives above:

- **Setup** — goal textarea + button restyled as Card + Button; add empty-state framing so the page doesn't look broken when only one field exists.
- **Dashboard** — four summary panels (Goal/Activity/Decisions/Blockers) as Cards in a responsive grid, ConfidenceBadge everywhere a confidence label is shown, transcript entries visually distinguished from summary panels (already separate sections, just needs stronger visual separation), reply box restyled.
- **Learner View** — message bubbles restyled as Cards, translated vs. original text visually differentiated (weight/color, not just line order).
- **History** — session entries restyled as Cards with clearer timestamp placement and decisions/blockers sub-sections visually separated (currently both under one card with only text labels).

## Delivery plan (git)

Sequential integration to guarantee zero merge conflicts — each PR branches from `main` *after* the previous one merges, so no two branches ever touch the same file concurrently:

1. **Issue + PR: "Design system foundation"** — tokens, `ui/` primitives, `AppShell` — no page rewrites.
2. **Issue + PR: "Restyle Setup page"**
3. **Issue + PR: "Restyle Dashboard page"**
4. **Issue + PR: "Restyle Learner View page"**
5. **Issue + PR: "Restyle History page"**

Each issue includes a mermaid diagram (component/token relationships for #1, before/after data-flow-unchanged note for #2-5) and a before screenshot (already in `docs/screenshots/`). Each PR includes an after screenshot captured via the dev server, plus updates the corresponding screenshot file in `docs/screenshots/`.

## Testing / verification

- `npm run lint` after each PR.
- Manual visual check via `npm run dev` + browser screenshot per page per PR (no visual regression test framework exists in this repo; out of scope to add one).
