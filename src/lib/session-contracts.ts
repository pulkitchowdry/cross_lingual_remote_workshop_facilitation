export const SUPPORTED_LANGUAGES = [
  { value: "en", label: "English" },
  { value: "zh", label: "Chinese" },
  { value: "es", label: "Spanish" },
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]["value"];

export type SessionRole = "facilitator" | "learner" | "co-facilitator" | "observer";

export interface CreateSessionInput {
  title: string;
  goal: string;
  sourceLanguage: SupportedLanguage;
  learnerLanguages: SupportedLanguage[];
  retentionDays: number;
}

export interface JoinSessionInput {
  displayName: string;
  preferredLanguage: SupportedLanguage;
  consent: boolean;
}
