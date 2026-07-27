# Confidence Score feature

## Context

`docs/CURRENT_FEATURE.md` specs a **Confidence Score**: every translated caption/chat
message should carry a combined-signal quality score (audio/STT/translation/
terminology/network), a High/Medium/Low level, a root-cause explanation when it's not
High, a recipient-facing "request clarification" action with a contextual reason, a
speaker-facing notification when their own speech is scoring low, and post-meeting
analytics. `docs/NEXT_FEATURE.md` (Centralised Glossary) is the planned terminology
signal source but doesn't exist yet.

Per your scope answers: build the **full spec end-to-end** (root-cause classification,
both recipient and speaker UI, clarification requests, post-meeting analytics), but
**stub network quality** (schema/UI carries no persisted field — a fixed constant feeds
the formula/UI, no client→server plumbing built) and **omit terminology** (not computed,
not stored, not shown — the root-cause enum reserves a value for it so the glossary
feature can wire in real detection later without another migration).

Today, real signals that could drive this already flow through the pipeline but are
thrown away:
- `local-inference/app/models/whisper.py`'s faster-whisper `Segment`s carry
  `avg_logprob`/`no_speech_prob`, discarded — only `.text` is kept.
- `local-inference/app/models/nllb.py`'s `translate_batch` can return per-hypothesis
  `.scores` (log-probs) via `return_scores=True`, never requested.
- `speech-to-text.ts`'s Deepgram parsing (`DeepgramListenResponse`,
  `DeepgramStreamingMessage`) only reads `.transcript`, ignoring
  `alternatives[0].confidence`.
- `translation.ts`'s Claude path already detects truncation (`stop_reason ===
  "max_tokens"`) but only logs it — never turns it into a confidence penalty.
- `Translation.qualitySignal`/`MessageTranslation.qualitySignal` are a `String?` always
  hardcoded to `"provider-confirmed"` — a placeholder, not a real signal.

This plan wires those real signals through, adds a composite-scoring module, persists
per-segment/per-translation confidence data, and builds the UI/analytics on top —
following the codebase's existing provider-tier, pure-aggregation-function, and
dict-i18n patterns rather than inventing new ones.

## 1. Prisma schema (`prisma/schema.prisma`)

New enums:
```prisma
enum ConfidenceLevel { HIGH MEDIUM LOW }
enum ConfidenceRootCause { AUDIO SPEECH_RECOGNITION TRANSLATION TERMINOLOGY NETWORK }
enum ClarificationReason { COULD_NOT_HEAR TRANSLATION_SEEMS_INCORRECT PLEASE_REPEAT PLEASE_EXPLAIN_DIFFERENTLY }
```
`TERMINOLOGY`/`NETWORK` are reserved values the classifier never emits yet (see §3) —
kept so the future glossary/network work doesn't need another enum migration.

Field additions:
- `TranscriptSegment`: `audioQuality Float?`, `sttConfidence Float?` — these describe
  the *source audio/ASR stage*, shared by every translation of that segment, so they
  live on the segment, not per-`Translation`.
- `Translation`: `translationConfidence Float?`, `confidenceScore Float?`,
  `confidenceLevel ConfidenceLevel?`, `rootCause ConfidenceRootCause?`. Keep the
  existing `qualitySignal` column as-is (unrelated churn to remove it).
- `MessageTranslation`: same four fields as `Translation` (no audio/STT fields — typed
  messages have no audio stage; composite there is translation+network only).

New model:
```prisma
model ClarificationRequest {
  id                  String              @id @default(cuid())
  sessionId           String
  requesterId         String
  transcriptSegmentId String?
  messageId           String?
  targetLanguage      String
  reason              ClarificationReason
  createdAt           DateTime            @default(now())
  resolvedAt          DateTime?
  session             Session             @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  requester           User                @relation(fields: [requesterId], references: [id])
  transcriptSegment   TranscriptSegment?  @relation(fields: [transcriptSegmentId], references: [id], onDelete: Cascade)
  message             Message?            @relation(fields: [messageId], references: [id], onDelete: Cascade)

  @@index([sessionId])
}
```
Add the back-relations (`ClarificationRequest[]`) on `Session`, `User`,
`TranscriptSegment`, `Message`. Exactly one of `transcriptSegmentId`/`messageId` is set
(caption vs. chat clarification) — enforced in the server action, not the schema.
`resolvedAt` lets analytics compute "average response time to clarification" (facilitator
marks resolved via a new action, mirroring `resolveInsight` in `facilitator/actions.ts`).

New migration under `prisma/migrations/`, timestamp-prefixed per existing convention
(e.g. `20260727120000_add_confidence_score`). Run `npm run db:generate` after.

## 2. Real signals: `local-inference/` (Python)

- **`app/models/whisper.py`**: `transcribe()` returns richer data instead of a bare
  string. Change its return type to a small dataclass/dict
  `{ text, avg_logprob, no_speech_prob }`, averaged across `segments` (weighted by
  segment duration if there are multiple; single segment is the common case). Keep
  `is_loaded()`/singleton shape per `local-inference/AGENTS.md`.
- **`app/routers/stt.py`**: `TranscribeResponse` gains `avgLogprob: float | None` and
  `noSpeechProb: float | None`. Router just passes through whatever `whisper.transcribe`
  returns.
- **`app/models/nllb.py`**: `translate()` calls `translate_batch(..., return_scores=True)`
  and returns `{ text, score }` (the hypothesis's normalized log-prob — CTranslate2
  normalizes by length by default). Update `translate()`'s signature/return.
- **`app/routers/translate.py`**: `TranslateResponse` gains `score: float | None`.
- Update `local-inference/tests/` (model + router tests, per `local-inference/AGENTS.md`
  §Testing) to mock the new return shapes — these mock the singletons already, so this
  is updating fixtures, not adding real-model tests.

## 3. `src/lib/confidence-score.ts` (new module)

Pure functions, no I/O — same shape as `confusion-level.ts`. This is the one place the
scoring formula/thresholds live, so nothing downstream duplicates the math.

```ts
export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";
export type ConfidenceRootCause = "AUDIO" | "SPEECH_RECOGNITION" | "TRANSLATION"; // TERMINOLOGY/NETWORK reserved, never emitted

export interface ConfidenceSignals {
  audioQuality: number | null;      // 0-1, null when not derivable (Deepgram tier, typed input)
  sttConfidence: number | null;     // 0-1, null for typed input (no ASR stage)
  translationConfidence: number | null; // 0-1, effectively always present when a translation exists
}

const NETWORK_QUALITY_STUB = 1.0; // see docs/CURRENT_FEATURE.md — stubbed for v1, see plan §Context
const WEIGHTS = { audioQuality: 0.25, sttConfidence: 0.35, translationConfidence: 0.30, networkQuality: 0.10 };

export function computeConfidenceScore(signals: ConfidenceSignals): {
  score: number; level: ConfidenceLevel; rootCause: ConfidenceRootCause | null;
}
```
- Renormalizes `WEIGHTS` over whichever signals are non-null (+ the always-present
  network stub) so a typed message (only `translationConfidence` non-null) still
  produces a 0-1 composite.
- Thresholds: `>= 0.85` HIGH, `>= 0.60` MEDIUM, else LOW (documented constants, same
  hardcoded-bucket style as `confusion-level.ts`).
- `rootCause`: `argmin` over the non-null signals (network stub excluded — it's
  constant 1.0 so it's never the true minimum); `null` when level is HIGH.

Also in this module:
- `deriveSttSignalsFromWhisper({ avgLogprob, noSpeechProb }) -> { audioQuality, sttConfidence }`
  — `sttConfidence = clamp(exp(avgLogprob), 0, 1)`, `audioQuality = clamp(1 - noSpeechProb, 0, 1)`.
- `deriveSttConfidenceFromDeepgram(confidence: number) -> number` — passthrough clamp;
  `audioQuality` stays `null` for this tier (Deepgram doesn't expose a distinct
  audio-clarity metric — documented limitation, not a bug).
- `deriveTranslationConfidence({ provider, score, truncated }) -> number` — NLLB:
  `clamp(exp(score), 0, 1)`; Claude: `1.0`, or `0.4` if `truncated` (the existing
  `stop_reason === "max_tokens"` check in `translateWithClaude`, now surfaced as a
  number instead of only a `console.error`).
- `speakerNotificationFor(rootCause, level)` — pure string-key lookup (not the string
  itself — returns which `dict.confidence*` key to render, keeping i18n text in
  `i18n.ts` per that file's own pattern) for the speaker-side low-confidence notice.

Colocated `confidence-score.test.ts` (Vitest, per `src/AGENTS.md` testing conventions)
covering: renormalization with 1/2/3 nulled signals, threshold boundaries, root-cause
tie-breaking, the whisper/deepgram/claude derivation helpers.

## 4. Provider plumbing

- **`src/lib/providers/local-inference-client.ts`**: `localTranslate` returns
  `{ text, score }`; `localTranscribe` returns `{ text, avgLogprob, noSpeechProb }` —
  read the new response fields instead of discarding them.
- **`src/lib/providers/translation.ts`**: `TranslationResult` gains
  `translationConfidence: number`. `translateWithClaude` computes it via
  `deriveTranslationConfidence` (using its existing `stop_reason` check) instead of the
  hardcoded `qualitySignal` literal; the NLLB path in `translateText` does the same
  from `localTranslate`'s new `score`.
- **`src/lib/providers/speech-to-text.ts`**:
  - `TranscriptSegmentDraft`/`StreamingTranscriptEvent` gain
    `audioQuality: number | null` and `sttConfidence: number | null`.
  - `transcribeChunkLocally`/local streaming path: derive both from
    `localTranscribe`'s new fields via `deriveSttSignalsFromWhisper`.
  - `DeepgramListenResponse`/`DeepgramStreamingMessage` (and
    `parseDeepgramStreamingMessage`): also read `alternatives[0].confidence`;
    `sttConfidence` via `deriveSttConfidenceFromDeepgram`, `audioQuality: null`.
  - `mockTranscribeChunk`: both `null` (matches its "not really transcribing" contract).
- **`src/lib/providers/local-speech-buffer.ts`** (`LocalBufferingSpeechToTextStream`):
  its `StreamingTranscriptEvent` is a structurally-duplicated type (per its own doc
  comment, to avoid a circular import) — add the same two fields here too, threaded
  from `localTranscribe`'s response in `flush()`.

## 5. Pipeline wiring

- **`src/lib/captions.ts`** (`publishTranslatedCaption`): after collecting
  `successfulTranslations` (each now carrying `translationConfidence`), also capture
  `audioQuality`/`sttConfidence` from the STT stage (threaded in via `input`, since
  `captions-socket.ts`/`caption-agent.ts` already have the `StreamingTranscriptEvent`
  that produced this segment — add `audioQuality`/`sttConfidence` to
  `publishTranslatedCaption`'s `input` type, `undefined`/`null` for the typed-caption
  caller in `facilitator/actions.ts`'s `publishCaption`, which has no STT stage at all).
  For each translation, call `computeConfidenceScore` with
  `{ audioQuality, sttConfidence, translationConfidence: result.translationConfidence }`
  and persist `confidenceScore`/`confidenceLevel`/`rootCause` alongside it in the
  `translations: { create: ... } }` block. Persist `audioQuality`/`sttConfidence` on
  the `transcriptSegment.create` call itself.
- **`src/app/sessions/actions.ts`** (`sendChatMessage`): same pattern, but
  `audioQuality`/`sttConfidence` are always `null` (typed input) — call
  `computeConfidenceScore({ audioQuality: null, sttConfidence: null,
  translationConfidence: result.translationConfidence })` per language and persist on
  each `MessageTranslation`.
- **`src/lib/caption-agent.ts`** / **`src/lib/captions-socket.ts`**: thread the
  `StreamingTranscriptEvent`'s new `audioQuality`/`sttConfidence` fields through to
  their `publishTranslatedCaption` call.

## 6. Clarification requests

- **New file `src/lib/clarification.ts`**: `createClarificationRequest({ sessionId,
  requesterId, transcriptSegmentId?, messageId?, targetLanguage, reason })` — thin
  Prisma-create wrapper (mirrors `publishTranslatedCaption`'s shape: one shared helper
  called from both a caption-context server action and a chat-context one).
- **Caption-side action**: add `requestCaptionClarification(sessionId, segmentId,
  reason, prevState, formData)` in `src/app/sessions/[sessionId]/learn/actions.ts` (or
  colocate near wherever the learn page's existing actions live — check that file
  first; if it doesn't exist yet, add to `facilitator/actions.ts`'s sibling on the
  learn side). Requires `learnerParticipantId`/session-access check matching
  `sendChatMessage`'s own pattern.
- **Chat-side**: same helper, callable from a new small action next to
  `sendChatMessage` in `src/app/sessions/actions.ts`.
- **Facilitator resolve action**: `resolveClarificationRequest(sessionId, requestId)`
  in `facilitator/actions.ts`, mirroring `resolveInsight` exactly (`updateMany` scoped
  by both ids, sets `resolvedAt: new Date()`, `revalidatePath`).
- **UI**: new **`src/components/ClarificationMenu.tsx`** (client component) — four
  reason buttons, each its own `useActionState` form (same one-`useActionState`-per-
  button pattern as `CaptionComprehensionActions.tsx`, so one button's pending state
  doesn't block another), submitting hidden `reason`/`segmentId`-or-`messageId` fields.
  Rendered:
  - In the `actions` slot of `TranscriptFeedEntry` (learn page's own feed-building code
    and `TranslationHistoryTab.tsx`), alongside `CaptionComprehensionActions`, gated on
    `confidenceLevel !== "HIGH"` for that segment's translation in the viewer's
    language.
  - In `SessionChatPanel.tsx`, under a message bubble whose resolved translation's
    `confidenceLevel !== "HIGH"`.

## 7. Confidence UI (recipient-facing)

- **`src/lib/translation-view.ts`**: `TranslatableItem`/`ResolvedTranslation` gain
  optional `confidenceScore`/`confidenceLevel`/`rootCause` (read off the matched
  translation, or the original-language case which is always "HIGH"/no rootCause).
- **`src/components/meeting/types.ts`**: `MeetingTranscriptSegment.translations` entries
  and `MeetingChatMessage.translations` entries gain the same three fields.
- **New `src/components/ConfidenceBadge.tsx`** (client component): small badge (🟢/🟡/🔴
  or existing `--tick-high/medium/low` CSS variables, matching `AnalyticsDrawer`'s
  existing color convention) + hover/expand panel showing Audio/STT/Translation/Network
  rows (Network always renders the stubbed constant — labelled so it's not confused
  with a live reading; Terminology row omitted entirely per scope). Rows with `null`
  values are omitted (Deepgram tier / typed input), not shown as 0%.
- Wire into: the learn page's own `TranscriptFeedEntry` construction, `CaptionOverlay.tsx`
  (badge next to each floating caption), `TranslationHistoryTab.tsx`,
  `SessionChatPanel.tsx` (badge next to each message bubble). All four already resolve
  per-viewer text via `resolveTranslatedText`/inline equivalents — thread the same
  resolved confidence fields alongside `text`/`lang`.

## 8. Speaker-facing notification

- **`src/components/LiveCaptionStream.tsx`**: after each `isFinal` segment event,
  compare its (session-language) confidence level; if `MEDIUM`/`LOW`, show a
  non-intrusive inline notice (same visual slot the existing `error` paragraph uses)
  built from `speakerNotificationFor`'s returned dict key — e.g. "We couldn't hear you
  clearly." / "This sentence could not be translated reliably." — with a one-line
  suggested action, matching the exact examples in `docs/CURRENT_FEATURE.md`'s Root
  Cause Classification section.
- **`src/lib/caption-agent.ts`** path (server-side, no client mic UI): surface via the
  facilitator dashboard instead — `facilitator/page.tsx` already re-renders on every
  `notifyCaptionsChanged` signal, so add a small notice card there driven by the most
  recent own-segment's confidence (already present in the `session.transcript` query),
  gated the same way.

## 9. Analytics

- **`src/lib/facilitator-analytics.ts`**: add
  `computeConfidenceStats(translations: { confidenceLevel, rootCause }[],
  clarificationRequests: { createdAt, resolvedAt }[]) -> ConfidenceStats` — average
  score, counts by level, counts by root cause, clarification count,
  `avgResponseMs` (now computable, unlike `computeBlockerStats`'s permanently-`null`
  one, since `ClarificationRequest.resolvedAt` exists). Extend `FacilitatorAnalytics`
  with a `confidence: ConfidenceStats` field.
- **`src/components/AnalyticsDrawer.tsx`**: one more `<Card>` (Confidence Score),
  following the exact existing pattern (plain-string rows precomputed server-side,
  passed as a new `confidenceSummaryRows: string[]` prop — RSC can't serialize `dict`
  formatter functions across this boundary, same as `participationRows` etc.).
- **`src/app/sessions/[sessionId]/facilitator/page.tsx`**: add one more query (parallel
  in the existing `Promise.all`) fetching all `Translation`/`MessageTranslation`
  confidence fields and `ClarificationRequest`s for the session, unbounded by
  `TRANSCRIPT_HISTORY_LIMIT`/`MESSAGE_HISTORY_LIMIT` — same rationale as the existing
  dedicated `allBlockerInsights`/`allMessagesForParticipation` queries (a capped include
  would silently undercount). Feed `computeConfidenceStats`, wire into both
  `AnalyticsDrawer` render sites (LIVE + ENDED), and extend the ENDED "Session Summary"
  card (`sessionSummaryHeading` block, ~line 415) with Average Confidence Score /
  Clarification Requests counts, matching `docs/CURRENT_FEATURE.md`'s "Communication
  Summary" example.

## 10. i18n (`src/lib/i18n.ts`)

New dict keys (added to all three `en`/`zh`/`es` blocks, matching every existing key's
triplication): `confidenceHigh/Medium/Low`, `confidenceBreakdownAudio/Stt/Translation/
Network`, `confidenceNetworkStubNotice` (small caption clarifying the network figure is
not yet a live reading), speaker notices per root cause (`confidenceAudioIssueNotice`,
`confidenceSttIssueNotice`, `confidenceTranslationIssueNotice`, each with a paired
suggested-action string), `clarificationReason*` (4 buttons) +
`clarificationSending`/`clarificationSent`, `analyticsConfidenceHeading` +
`analyticsConfidenceSummary(...)` formatter, `sessionSummaryAvgConfidence`,
`sessionSummaryClarificationRequests`.

## 11. Tests

- `src/lib/confidence-score.test.ts` (new, see §3).
- Update existing colocated tests that construct `TranslationResult`/
  `TranscriptSegmentDraft` fixtures (`translation.test.ts`, `speech-to-text.test.ts` if
  present) to include the new fields — grep for `qualitySignal:` / `isFinal:` fixture
  literals first to find every call site.
- `local-inference/tests/`: update `test_nllb.py`/`test_whisper.py` (or equivalent) and
  the router tests for the new response shapes.
- New `src/lib/facilitator-analytics.test.ts` additions for `computeConfidenceStats`
  (file likely already has colocated tests for the other `compute*` functions — extend
  rather than create a new file if so).

## Verification

1. `npm test` (Vitest) — new/updated unit tests for `confidence-score.ts`, provider
   fixture updates, `facilitator-analytics.ts`.
2. `cd local-inference && pytest` — updated model/router tests.
3. `npm run db:generate` after the migration, then `npx prisma migrate dev` locally
   against a dev Postgres (per schema.prisma's own header comment) to confirm it
   applies cleanly.
4. Manual smoke test via the `run` skill: start a session, publish a few typed captions
   and chat messages (mock/no-provider mode is fine to confirm the composite score still
   computes from `translationConfidence` alone and renders a badge), then — if
   `LOCAL_INFERENCE_URL`/`STT_API_KEY` are configured locally — a live mic caption to
   confirm real whisper/Deepgram-derived scores vary and a low-confidence badge +
   clarification button appear; check the facilitator AnalyticsDrawer's new Confidence
   card and the ENDED-session summary card.
