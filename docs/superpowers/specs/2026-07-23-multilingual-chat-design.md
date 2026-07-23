# Multilingual Chat — Design

Source: `docs/FEATURE_LIST.md`, Module 2 — Participate, "Multilingual Chat".

## Problem

Learners currently have a one-way question box (`QuestionBox`) and the facilitator a one-way
reply box (`ReplyBox`) — good for the specific Q&A loop, but the feature list separately calls
for an open **shared chat** where any participant (facilitator or any learner) posts a message
in their own language and everyone sees it translated into theirs.

## Scope

- One shared, class-wide chat thread — not private per-learner threads (matches "Messages are
  automatically translated for every recipient" in the feature list, and is simplest to demo
  alongside the existing shared transcript/captions).
- Mock/demo data only — this repo has no real speech/translation backend; every other feature
  (captions, glossary, simplify, Q&A) is pre-baked mock data rendered through UI components.
  Chat follows the same pattern.
- No persistence, no cross-tab/cross-page sync, no read receipts. Locally-typed messages are
  appended to the sending page's local state only, shown as-is (no fabricated translation),
  consistent with how `QuestionBox`/`ReplyBox` already behave.

## Data model

Add to `src/lib/types.ts`:

```ts
export interface ChatMessage {
  id: string;
  senderName: string;
  senderRole: "facilitator" | "learner";
  language: string;                      // sender's own language, e.g. "English", "Mandarin"
  translations: Record<string, string>;  // language -> text, includes the sender's own language
}
```

A `translations` map (rather than a single `original`/`translation` pair like `TranscriptEntry`)
is needed because a shared chat has more than two viewer languages live at once, unlike the
existing 1:1 facilitator/learner pairs used elsewhere in the app.

## Mock data

Add `mockChatMessages: ChatMessage[]` to `src/lib/mock-data.ts`: a handful of messages from the
facilitator (English) and a couple of learners (Mandarin, Spanish), each with translations
covering the four languages already present in `mockParticipation` (English, Mandarin, Spanish,
French).

## Component

New client component `src/components/ChatPanel.tsx`:

- Props: `messages: ChatMessage[]`, `viewerLanguage: string`.
- Renders each message as a bubble, visually consistent with `FacilitatorMessage` /
  `TranscriptEntryView` (speaker-colored left border via `getSpeakerColor`): sender name, the
  text in `translations[viewerLanguage]` (falls back to the message's own `language` entry if
  missing), and a muted "original" line shown only when the viewer's language differs from the
  sender's language.
- A textarea + send button, shaped like `QuestionBox`, appends a new message to local component
  state tagged with `viewerLanguage` as its `language`, rendered as typed (no fabricated
  translation, since there is no real translation engine here).

## Wiring

- `src/app/dashboard/page.tsx`: new "Chat" section, `viewerLanguage="English"` (the
  facilitator's language).
- `src/app/learner/page.tsx`: new "Chat" section, `viewerLanguage={currentLearner.language}`.

## Out of scope

Backend/persistence, cross-tab sync, read receipts, private threads, real translation.

## Testing

Existing repo has no test suite for components (verified by grep of `src/` for `*.test.*` /
`*.spec.*` — none found); verification will be manual (`npm run dev`, exercise both pages) plus
`npm run lint` / `npm run build`.
