export type InsightKind = "ACTIVITY" | "DECISION" | "BLOCKER" | "CONFUSION";

export interface InsightSourceSegment {
  id: string;
  originalText: string;
}

export interface InsightDraft {
  type: InsightKind;
  summary: string;
  /** Must reference IDs from the segments passed in; callers reject a draft citing an unknown ID. */
  sourceSegmentIds: string[];
}

/**
 * Server-only boundary for the structured-insight LLM call described in
 * PLAN.md Phase 3. No provider is wired yet — `MockInsightProvider` returns no
 * insights so the dashboard stays empty (never fabricated) until
 * `INSIGHT_MODEL_API_KEY` is configured and a real implementation lands.
 */
export interface InsightProvider {
  readonly isConfigured: boolean;
  generateInsights(input: {
    sessionGoal: string;
    finalSegments: InsightSourceSegment[];
  }): Promise<InsightDraft[]>;
}

class MockInsightProvider implements InsightProvider {
  readonly isConfigured = false;

  async generateInsights(): Promise<InsightDraft[]> {
    return [];
  }
}

export const insightProvider: InsightProvider = new MockInsightProvider();

/** Server-side guardrail: never persist an insight that cites a segment outside the batch it was derived from. */
export function validateInsightDraft(draft: InsightDraft, knownSegmentIds: ReadonlySet<string>): boolean {
  if (draft.sourceSegmentIds.length === 0) return false;
  return draft.sourceSegmentIds.every((id) => knownSegmentIds.has(id));
}
