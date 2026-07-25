import type { SupportedLanguage } from "@/lib/session-contracts";

export type InsightKind = "ACTIVITY" | "DECISION" | "BLOCKER" | "CONFUSION";

export interface InsightSourceSegment {
  id: string;
  originalText: string;
}

const languageName: Record<SupportedLanguage, string> = {
  en: "English",
  zh: "Chinese",
  es: "Spanish",
};

export interface InsightDraft {
  type: InsightKind;
  summary: string;
  /** Must reference IDs from the segments passed in; callers reject a draft citing an unknown ID. */
  sourceSegmentIds: string[];
}

/**
 * Server-only boundary for the structured-insight LLM call described in
 * PLAN.md Phase 3. Matches TranslationProvider's shape: a single Claude-backed
 * implementation whose own isConfigured getter and generateInsights fallback
 * keep the dashboard empty (never fabricated) until INSIGHT_MODEL_API_KEY is set.
 */
export interface InsightProvider {
  readonly isConfigured: boolean;
  generateInsights(input: {
    sessionGoal: string;
    sourceLanguage: SupportedLanguage;
    finalSegments: InsightSourceSegment[];
    alreadyNoted?: string[];
  }): Promise<InsightDraft[]>;
}

const INSIGHT_KINDS: readonly InsightKind[] = ["ACTIVITY", "DECISION", "BLOCKER", "CONFUSION"];
const INSIGHT_MODEL = "claude-haiku-4-5-20251001"; // background analysis, not the live caption path — keep it fast and cheap

function isInsightDraftShape(value: unknown): value is InsightDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Record<string, unknown>;
  const validType = typeof draft.type === "string" && (INSIGHT_KINDS as readonly string[]).includes(draft.type);
  const validSummary = typeof draft.summary === "string" && draft.summary.trim().length > 0;
  const validIds =
    Array.isArray(draft.sourceSegmentIds) &&
    draft.sourceSegmentIds.length > 0 &&
    draft.sourceSegmentIds.every((id) => typeof id === "string");
  return validType && validSummary && validIds;
}

/** Strips a ```json ... ``` (or bare ``` ... ```) code fence — models routinely wrap "reply with ONLY JSON" in one anyway. */
function stripMarkdownFence(text: string): string {
  const match = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : text.trim();
}

/** Defensive parsing: a malformed or unexpected LLM response degrades to no insights, never a thrown error. */
export function parseInsightDraftsResponse(payload: unknown): InsightDraft[] {
  if (!payload || typeof payload !== "object") return [];
  const content = (payload as { content?: Array<{ type?: string; text?: string }> }).content;
  const text = content?.find((block) => block.type === "text")?.text;
  if (!text) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripMarkdownFence(text));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isInsightDraftShape);
}

function buildUserContent(input: {
  sessionGoal: string;
  finalSegments: InsightSourceSegment[];
  alreadyNoted?: string[];
}): string {
  const segmentLines = input.finalSegments.map((segment) => `[${segment.id}] ${segment.originalText}`).join("\n");
  const notedLines = input.alreadyNoted?.length
    ? `\n\nAlready noted — do not repeat these unless genuinely new evidence emerged:\n${input.alreadyNoted.map((summary) => `- ${summary}`).join("\n")}`
    : "";
  return `Workshop goal: ${input.sessionGoal}\n\nTranscript segments (id: text):\n${segmentLines}${notedLines}`;
}

/**
 * The facilitator dashboard (ACT NOW) renders `summary` directly, unlike the
 * transcript/chat panels — there's no per-viewer translation step for it. Without
 * telling the model which language to reply in, it tends to default toward English
 * regardless of the transcript's actual language, producing a BLOCKER summary in a
 * different language than the evidence quote sitting right next to it (that quote is
 * the raw transcript segment, always in the session's real source language).
 */
function buildSystemPrompt(sourceLanguage: SupportedLanguage): string {
  return (
    "You are observing a live, possibly multilingual workshop transcript to help a facilitator notice things they might miss. " +
    "Given the workshop goal and a batch of transcript segments (each with a stable id and its original-language text), " +
    "identify only genuinely new, clearly-evidenced items: ACTIVITY (what the group is currently doing), " +
    "DECISION (a decision the group made), BLOCKER (an unresolved problem blocking progress), or CONFUSION (signs of misunderstanding). " +
    "It is correct and expected to report nothing for ordinary chatter — do not fabricate signal that isn't there. " +
    "Every item must cite the ids of the specific segments that justify it. " +
    `Write every "summary" in ${languageName[sourceLanguage]}, regardless of what language the transcript segments or workshop goal are in — the facilitator reads this dashboard in that language. ` +
    'Reply with ONLY a JSON array, no commentary: [{"type": "ACTIVITY"|"DECISION"|"BLOCKER"|"CONFUSION", "summary": string, "sourceSegmentIds": string[]}]. ' +
    "Return [] if nothing new stands out."
  );
}

class ClaudeInsightProvider implements InsightProvider {
  get isConfigured() {
    return Boolean(process.env.INSIGHT_MODEL_API_KEY);
  }

  async generateInsights(input: {
    sessionGoal: string;
    sourceLanguage: SupportedLanguage;
    finalSegments: InsightSourceSegment[];
    alreadyNoted?: string[];
  }): Promise<InsightDraft[]> {
    const apiKey = process.env.INSIGHT_MODEL_API_KEY;
    if (!apiKey || input.finalSegments.length === 0) return [];

    const response = await fetch(process.env.CLAUDE_API_URL ?? "https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: INSIGHT_MODEL,
        max_tokens: 1024,
        system: buildSystemPrompt(input.sourceLanguage),
        messages: [{ role: "user", content: buildUserContent(input) }],
      }),
      cache: "no-store",
      // Matches translateWithClaude's timeout — without it, a hung Claude response rides
      // this call's own Postgres advisory-lock transaction all the way to its 20s
      // timeout (see insights.ts) instead of failing fast.
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      // Matches translateWithClaude's logging — without it, a broken but *configured*
      // provider (bad key, rate limit, model deprecation) is silently indistinguishable
      // from "working, nothing new to report" every single time.
      console.error(`ClaudeInsightProvider: Claude API responded ${response.status} ${await response.text()}`);
      return [];
    }
    return parseInsightDraftsResponse(await response.json());
  }
}

export const insightProvider: InsightProvider = new ClaudeInsightProvider();

/** Server-side guardrail: never persist an insight that cites a segment outside the batch it was derived from. */
export function validateInsightDraft(draft: InsightDraft, knownSegmentIds: ReadonlySet<string>): boolean {
  if (draft.sourceSegmentIds.length === 0) return false;
  return draft.sourceSegmentIds.every((id) => knownSegmentIds.has(id));
}
