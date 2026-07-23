# AI Glossary

Implements the **AI Glossary** feature from `FEATURE_LIST.md` (Module 1 — Understand) as a mocked, frontend-only flow on the learner page.

## Flow

```mermaid
flowchart TD
    A["mockGlossary entries\n(term + pronunciation + definition + example + translation)"] --> B[GlossaryText component]
    B --> C["Original-language line of a FacilitatorMessage\n(split on known glossary terms)"]
    C --> D{Learner clicks\na highlighted term}
    D -- open --> E["Show definition, pronunciation,\nexample, and translation inline"]
    D -- click again / another term --> F[Close or switch popover]
    E --> G[Learner page /learner]
    F --> G
```

## Notes

- `mockGlossary` is precomputed mock data (`src/lib/mock-data.ts`), not a live term-extraction call — consistent with the rest of the prototype (live captions, confidence, simplify explanation are all mocked).
- `GlossaryText` (`src/components/GlossaryText.tsx`) splits a line of text on known glossary terms and renders each match as a clickable, underlined term; clicking opens an inline card (reusing `Card`) with the term's pronunciation, definition, example, and translation — no page navigation required.
- Popover open/close state is local to each `GlossaryText` instance, so only one term's card is open per message at a time.
- Wired into `FacilitatorMessage` on the learner view, over the original-language line, since that's where an unfamiliar technical term is most likely to appear untranslated.
- Screenshots: `docs/screenshots/ai-glossary-before.png`, `docs/screenshots/ai-glossary-after.png` (after shows the `validateEmail()` term's glossary card open).
