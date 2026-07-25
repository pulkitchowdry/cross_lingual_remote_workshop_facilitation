export type MeetingChatMessage = {
  id: string;
  originalText: string;
  language: string;
  kind?: string;
  sentAt?: string | Date;
  sender: { displayName: string };
  translations: Array<{ targetLanguage: string; text: string }>;
};

export type MeetingTranscriptSegment = {
  id: string;
  speakerId: string | null;
  originalText: string;
  language: string;
  translations: Array<{ targetLanguage: string; text: string }>;
};
