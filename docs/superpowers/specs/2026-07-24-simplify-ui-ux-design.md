# Simplify UI/UX to one working session flow

## Problem

The app had two disconnected UIs: a real, database-backed live session flow
(`/setup` → `/sessions/[id]/facilitator` / `/sessions/[id]/learn` →
`/join/[token]`) and an entirely separate mock-data demo
(`/dashboard`, `/learner`, `/history`). The primary navigation
(`AppShell.tsx`) pointed at the mock pages, not the real flow, so a
first-time visitor could not find the actual product. The real pages also
duplicated affordances internally: a free-form chat panel and a separate
"ask a question" form said the same thing to the other party in two
different UIs, and a placeholder "publish a translated caption" textarea
sat awkwardly next to the live video room with apologetic copy.

This works against the hackathon judging criteria in
`docs/problem_statement.md` — specifically "Prototype Quality: works
reliably and is easy to use."

## Change

1. **One flow.** Deleted the mock `/dashboard`, `/learner`, `/history`
   routes and every component that existed only to support them
   (`ParticipationDashboard`, `QuietParticipantNudge`,
   `RaiseHandSuggestion`, `GlossaryText`, `PollWidget`, `PollResults`,
   `SummaryCard`, `FacilitatorMessage`, `TranscriptEntryView`,
   `QuestionBox`, `ReplyBox`, `LiveCaptionTicker`, `mock-data.ts`). None of
   these were wired to the real session — they were pure decoration that
   could not be demoed live and added navigation confusion.
2. **Simplified nav.** `AppShell.tsx` now shows a single "New session"
   link instead of four links, three of which pointed at the
   now-removed mock pages.
3. **Merged chat and questions into one stream.** `SessionChatPanel` now
   accepts an `allowQuestions` flag that adds a "Flag as question for the
   facilitator" checkbox next to the send button. The learner page no
   longer has a separate "Ask the facilitator" form, and the facilitator
   page no longer has a separate "Learner questions" section — flagged
   questions show a "Question" badge inline in the same translated chat
   the facilitator already watches. `sendChatMessage` accepts an optional
   `kind` field instead of `askFacilitator` being a second server action.
4. **Reworked the caption publisher.** Kept the manual "publish a
   translated caption" capability (it is currently the only way to
   populate the transcript, since automatic speech-to-text isn't wired
   into the LiveKit room yet) but moved it into a compact one-line bar
   directly under the video room instead of a separate section with
   hedging copy, so it reads as part of the live room rather than a
   second, competing input channel.

## Result

Routes: 8 → 5 (`/`, `/setup`, `/join/[token]`,
`/sessions/[id]/facilitator`, `/sessions/[id]/learn`).
Nav links: 4 → 1.
Components deleted: 12, plus `mock-data.ts`.

Kept everything that maps to the minimum requirements: facilitator +
learner roles, 2+ languages, real-time LiveKit room, translated
transcript/chat, and the consent step on `/join/[token]`.
