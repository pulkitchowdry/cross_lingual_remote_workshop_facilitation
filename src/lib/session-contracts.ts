export const SUPPORTED_LANGUAGES = [
  { value: "en", label: "English" },
  { value: "zh", label: "Chinese" },
  { value: "es", label: "Spanish" },
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]["value"];

/**
 * Both the facilitator and learner pages poll every 2s (SessionAutoRefresh)
 * for the life of a LIVE session and re-fetch the full chat/Q&A history each
 * time with no pagination — bounding it keeps DB read volume and page payload
 * size from growing linearly with session length/message count.
 */
export const MESSAGE_HISTORY_LIMIT = 50;

export type SessionRole = "facilitator" | "learner" | "co-facilitator" | "observer";

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
