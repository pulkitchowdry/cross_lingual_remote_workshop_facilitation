/** `nativeLabel` is the language's own autonym (e.g. "中文" for Chinese) — used as-is
 * regardless of UI language, unlike `label`/the translated `languageNames` dictionary
 * in `@/lib/i18n`. */
export const SUPPORTED_LANGUAGES = [
  { value: "en", label: "English", nativeLabel: "English" },
  { value: "zh", label: "Chinese", nativeLabel: "中文" },
  { value: "es", label: "Spanish", nativeLabel: "Español" },
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]["value"];

/**
 * Both the facilitator and learner pages poll every 2s (SessionAutoRefresh)
 * for the life of a LIVE session and re-fetch the full chat/Q&A history each
 * time with no pagination — bounding it keeps DB read volume and page payload
 * size from growing linearly with session length/message count.
 */
export const MESSAGE_HISTORY_LIMIT = 50;

/**
 * Same rationale as `MESSAGE_HISTORY_LIMIT`, applied to `Session.transcript` —
 * unlike `messages`, the transcript query had no cap at all, so a long-running
 * LIVE session's full caption/STT history was re-fetched and re-rendered on
 * every 2s poll for as long as it stayed live, on both the facilitator and
 * every learner's page.
 */
export const TRANSCRIPT_HISTORY_LIMIT = 100;

/**
 * Same rationale as `TRANSCRIPT_HISTORY_LIMIT`/`MESSAGE_HISTORY_LIMIT`, applied to
 * `Session.insights` — unlike those two, the facilitator dashboard's `insights`
 * include (with a heavier nested evidence -> transcriptSegment -> translations join)
 * had no cap at all, so a long-running session's full, ever-growing insight history
 * was re-fetched and re-joined on every 2s poll.
 */
export const INSIGHT_HISTORY_LIMIT = 50;

/**
 * `sendChatMessage`'s own max chat/question message length (src/app/sessions/actions.ts).
 * Exported so callers that *generate* a message on a learner's behalf — currently
 * CaptionComprehensionActions' "Explain simply"/"Give an example" quick-questions,
 * built in learn/page.tsx by wrapping a caption (itself allowed up to 3,000 characters)
 * in a fixed phrase — can size their own truncation against the same real limit instead
 * of guessing a safe-feeling number that silently drifts out of sync.
 */
export const CHAT_MESSAGE_MAX_LENGTH = 1_000;

/**
 * "Explain simply"/"Give an example" (CaptionComprehensionActions, used from both a
 * caption's own comprehension actions and a chat message's) wrap a quoted caption or
 * message verbatim in a fixed phrase (see i18n.ts's explainSimplyQuestion/
 * giveExampleQuestion) and submit it through the same sendChatMessage that caps every
 * message at CHAT_MESSAGE_MAX_LENGTH — but a caption itself is allowed up to 3,000
 * characters (facilitator/learn actions' own publish caps). Left untruncated, a caption
 * (or, less likely, a long chat message) long enough makes the generated question
 * exceed the chat cap, and sendChatMessage rejects it every single time with no way for
 * the asker to shorten text they didn't write themselves — the button becomes
 * permanently, silently broken for that line. The margin below is comfortably larger
 * than the longest wrapper phrase + quote marks across en/zh/es.
 */
const QUOTED_QUESTION_WRAPPER_MARGIN = 150;
export function truncateForQuotedQuestion(text: string): string {
  const maxLength = CHAT_MESSAGE_MAX_LENGTH - QUOTED_QUESTION_WRAPPER_MARGIN;
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

export type SessionRole = "facilitator" | "learner" | "co-facilitator" | "observer";

/**
 * Return shape for a `useActionState`-driven Server Action whose expected, routine
 * failures (rate limited, session not live, input too long) should show up as an
 * inline message next to the form instead of throwing — a thrown Error with no
 * boundary in the tree crashes the whole route (see RouteErrorFallback.tsx), taking
 * down the live video call along with it for what's often just a mistimed click.
 */
export interface FormActionResult {
  error: string | null;
}

export type TranslationMode = "AUTO" | "LOCAL_ONLY";

export interface CreateSessionInput {
  title: string;
  goal: string;
  sourceLanguage: SupportedLanguage;
  learnerLanguages: SupportedLanguage[];
  retentionDays: number;
  /** AUTO (default): local-inference first, cloud fallback on failure. LOCAL_ONLY: never call cloud providers. */
  translationMode?: TranslationMode;
}

export interface JoinSessionInput {
  displayName: string;
  preferredLanguage: SupportedLanguage;
  consent: boolean;
}

/** Published when a final transcript segment (and its translations) becomes available on the live channel. */
export interface TranscriptSegmentEvent {
  type: "transcript-segment";
  sessionId: string;
  segmentId: string;
  speakerId: string | null;
  originalText: string;
  language: SupportedLanguage;
  startedAt: string;
  endedAt: string;
  translations: Array<{ targetLanguage: SupportedLanguage; text: string; provider: string }>;
}

/** Published when a chat/Q&A message and its per-recipient-language translations are persisted. */
export interface TranslatedMessageEvent {
  type: "translated-message";
  sessionId: string;
  messageId: string;
  senderId: string;
  recipientId: string | null;
  kind: "CHAT" | "QUESTION" | "REPLY";
  originalText: string;
  language: SupportedLanguage;
  sentAt: string;
  translations: Array<{ targetLanguage: SupportedLanguage; text: string; provider: string }>;
}

/** Published when the facilitator dashboard's grounded insight set changes. */
export interface DashboardUpdateEvent {
  type: "dashboard-update";
  sessionId: string;
  insightId: string;
  kind: "ACTIVITY" | "DECISION" | "BLOCKER" | "CONFUSION";
  status: "ACTIVE" | "RESOLVED" | "SUPERSEDED";
  summary: string;
  sourceSegmentIds: string[];
}

/** Published once when a facilitator ends a session, after final snapshots are written. */
export interface SessionCompletionEvent {
  type: "session-completion";
  sessionId: string;
  endedAt: string;
  participantCount: number;
  transcriptSegmentCount: number;
}

export type LiveSessionEvent =
  | TranscriptSegmentEvent
  | TranslatedMessageEvent
  | DashboardUpdateEvent
  | SessionCompletionEvent;
