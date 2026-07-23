# Simplify Explanation

Implements the **Simplify Explanation** feature from `FEATURE_LIST.md` (Module 1 — Understand) as a mocked, frontend-only flow on the learner page.

## Flow

```mermaid
flowchart TD
    A["mockFacilitatorReplies entry\n(original + translation + simplified)"] --> B[FacilitatorMessage component]
    B --> C{Learner clicks\n'Simplify explanation'}
    C -- toggle on --> D["Show entry.simplified\n(original + translation) + 'simplified' tag"]
    C -- toggle off --> E["Show entry.original + entry.translation\n(unchanged)"]
    D --> F[Learner page /learner]
    E --> F
```

## Notes

- `simplified` is precomputed mock data on `TranscriptEntry` (`src/lib/mock-data.ts`), not a live AI call — consistent with the rest of the prototype (live captions, confidence, transcripts are all mocked).
- Toggle state is local to each `FacilitatorMessage` instance; no global state needed.
- Screenshots: `docs/screenshots/simplify-explanation-before.png`, `docs/screenshots/simplify-explanation-after.png`.
