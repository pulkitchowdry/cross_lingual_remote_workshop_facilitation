export type MeetingChatMessage = {
  id: string;
  originalText: string;
  language: string;
  kind?: string;
  sentAt?: string | Date;
  isAnonymous?: boolean;
  recipientId?: string | null;
  sender: { id: string; displayName: string };
  translations: Array<{ targetLanguage: string; text: string }>;
};

export type MeetingTranscriptSegment = {
  id: string;
  speakerId: string | null;
  originalText: string;
  language: string;
  startedAt: string | Date;
  translations: Array<{ targetLanguage: string; text: string }>;
};
