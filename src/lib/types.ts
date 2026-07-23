export type Confidence = "high" | "medium" | "low";

export interface SimplifiedExplanation {
  original: string;
  translation: string;
}

export interface TranscriptEntry {
  id: string;
  speaker: string;
  original: string;
  translation: string;
  confidence: Confidence;
  hasPreservedSpan: boolean;
  simplified?: SimplifiedExplanation;
}

export interface GlossaryEntry {
  id: string;
  term: string;
  pronunciation: string;
  definition: string;
  example: string;
  translation: string;
}

export interface Blocker {
  id: string;
  summary: string;
  quoteId: string;
}

export interface Decision {
  id: string;
  summary: string;
  quoteId: string;
}

export interface SessionSummary {
  id: string;
  timestamp: string;
  activity: string;
  decisions: string[];
  blockers: string[];
}

export interface PollOption {
  id: string;
  text: string;
  votes: number;
}

export interface Poll {
  id: string;
  question: string;
  options: PollOption[];
  status: "active" | "closed";
}
