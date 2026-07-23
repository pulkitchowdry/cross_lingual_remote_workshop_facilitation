export type Confidence = "high" | "medium" | "low";

export interface TranscriptEntry {
  id: string;
  speaker: string;
  original: string;
  translation: string;
  confidence: Confidence;
  hasPreservedSpan: boolean;
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
