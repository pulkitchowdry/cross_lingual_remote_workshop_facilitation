import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { insightProvider, validateInsightDraft, type InsightDraft } from "@/lib/providers/insight";
import type { Session } from "@/generated/prisma/client";
import type { SupportedLanguage } from "@/lib/session-contracts";

const CONTEXT_WINDOW = 20;
/** Word-overlap (Jaccard) threshold above which a new draft is treated as a paraphrase of an already-noted insight, not genuinely new. */
const DUPLICATE_SUMMARY_SIMILARITY = 0.6;
/**
 * Caps how many of a session's own past insight summaries get sent to the model as
 * "already noted" context. Without a cap, a multi-hour workshop accumulating hundreds
 * of insights would re-send its *entire* history on every single caption-triggered
 * call — this background analysis is on the hot path of every final caption
 * (captions.ts fires it unawaited after each one), so token usage/latency/cost here
 * would grow linearly and unboundedly with session length instead of staying capped.
 * Only the most recent ones matter in practice for catching a near-term repeat.
 */
const ALREADY_NOTED_LIMIT = 30;

/**
 * Analyzes the session's recent transcript for new facilitator-dashboard
 * insights (ACTIVITY/DECISION/BLOCKER/CONFUSION), grounded in real segment
 * citations via validateInsightDraft (issue: the AI understanding layer was
 * previously permanently mocked — see MockInsightProvider's removal).
 *
 * Called from publishTranslatedCaption via waitUntil so it never adds
 * latency to the live-caption path. Every failure mode here — no API key,
 * a network error, a malformed model response — degrades to "no new
 * insight", matching the mock provider's original safe-empty behavior; a
 * missed insight is far less harmful than a caption delayed by an unrelated
 * background analysis call.
 *
 * Consecutive final captions (a couple of seconds apart in live speech) each
 * trigger their own `waitUntil` call for the same session, all reading the
 * "already noted" snapshot before any of them has written — a Postgres
 * session-scoped advisory lock (`pg_advisory_xact_lock`, released
 * automatically at transaction end) serializes those into one at a time per
 * session, so two overlapping calls can't both persist the same insight.
 * Holding one Postgres connection for the duration of the Claude call this
 * wraps is a deliberate tradeoff: this path is already off the user-facing
 * latency budget (`waitUntil`), and workshop-scale concurrency here is low.
 */
export async function generateSessionInsights(session: Session): Promise<void> {
  if (!insightProvider.isConfigured) return;
  // Unlike TranslationProvider/SpeechToTextProvider/TextToSpeechProvider, InsightProvider
  // has no local-inference tier at all — ClaudeInsightProvider always calls Anthropic's
  // cloud API directly, with no `allowCloudFallback` gate to honor. A Strict Privacy Mode
  // session (translationMode LOCAL_ONLY) choosing to never send audio/text to external
  // providers must not have its transcript sent to Claude here either; skipping outright
  // (not just degrading empty on failure, this repo's existing pattern for the *other*
  // providers) is the only correct behavior since there's no local fallback to try first.
  if (session.translationMode === "LOCAL_ONLY") return;

  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${session.id}))`;

        // `desc` (newest first) is what makes `take: CONTEXT_WINDOW` cheaply grab the
        // *most recent* segments — but the model needs to read them oldest-first, the
        // same chronological order the conversation actually happened in, or it can
        // read a resolution before the problem it resolved and misjudge cause and
        // effect (e.g. emitting a BLOCKER for an issue that was already fixed earlier
        // in the same batch). `session.transcript` is reversed the identical way
        // before rendering (see facilitator/page.tsx) — this is the one place that
        // reversal was missing.
        const recentSegments = (
          await tx.transcriptSegment.findMany({
            where: { sessionId: session.id, isFinal: true },
            orderBy: { startedAt: "desc" },
            take: CONTEXT_WINDOW,
            select: { id: true, originalText: true },
          })
        ).reverse();
        if (recentSegments.length === 0) return;

        // ACTIVE only — a RESOLVED insight (resolveInsight, facilitator/actions.ts) means
        // the facilitator explicitly dealt with it; a genuine recurrence of that same
        // issue is new information worth surfacing again, not a duplicate to discard.
        // Without this filter, an old BLOCKER the facilitator already resolved kept
        // silently suppressing every later re-report of the exact same problem for the
        // rest of the session.
        const existingInsights = await tx.insight.findMany({
          where: { sessionId: session.id, status: "ACTIVE" },
          orderBy: { createdAt: "desc" },
          take: ALREADY_NOTED_LIMIT,
          select: { summary: true },
        });
        const alreadyNoted = existingInsights.map((insight) => insight.summary);

        const drafts = await insightProvider.generateInsights({
          sessionGoal: session.goal,
          sourceLanguage: session.sourceLanguage as SupportedLanguage,
          finalSegments: recentSegments.map((segment) => ({ id: segment.id, originalText: segment.originalText })),
          alreadyNoted,
        });

        const knownSegmentIds = new Set(recentSegments.map((segment) => segment.id));
        const newDrafts = selectNewDrafts(drafts, knownSegmentIds, alreadyNoted);
        if (newDrafts.length === 0) return;

        for (const draft of newDrafts) {
          await tx.insight.create({
            data: {
              sessionId: session.id,
              type: draft.type,
              summary: draft.summary,
              // Dedupe: InsightEvidence's primary key is (insightId, transcriptSegmentId) —
              // a model draft citing the same segment id twice would otherwise violate that
              // unique constraint and abort the whole createMany for this insight.
              evidence: {
                createMany: { data: Array.from(new Set(draft.sourceSegmentIds)).map((id) => ({ transcriptSegmentId: id })) },
              },
            },
          });
        }

        revalidatePath(`/sessions/${session.id}/facilitator`);
      },
      // The Claude call inside this transaction can take a few seconds; Prisma's default
      // 5s transaction timeout is tuned for pure-DB work and would abort a slow-but-healthy
      // analysis call.
      { timeout: 20_000 },
    );
  } catch (error) {
    // Best-effort background analysis — never let this affect the live caption path,
    // but still log it: a bare swallow here also makes the caller's own
    // `.catch((error) => console.error(...))` unreachable dead code, so this was
    // the only place a systemic failure (schema drift, connection exhaustion,
    // provider errors) could actually surface.
    console.error("generateSessionInsights failed", error);
  }
}

/**
 * Filters a batch of drafts down to the genuinely new, valid ones — extracted as its
 * own pure function so this logic is testable without mocking Prisma/the insight
 * provider. Sequential, not a single `.filter()` pass: a single Claude response can
 * itself contain two near-duplicate drafts (e.g. rephrasing the same blocker twice
 * across two segments in the same batch), which filtering only against the
 * pre-existing `alreadyNoted` snapshot never catches, since neither draft duplicates
 * anything that existed *before* this call. Folding each accepted draft's summary
 * into the running `notedSoFar` list immediately is what makes a later draft in the
 * same batch correctly see an earlier one it duplicates.
 */
export function selectNewDrafts(
  drafts: InsightDraft[],
  knownSegmentIds: ReadonlySet<string>,
  alreadyNoted: readonly string[],
): InsightDraft[] {
  const notedSoFar = [...alreadyNoted];
  const newDrafts: InsightDraft[] = [];
  for (const draft of drafts) {
    if (!validateInsightDraft(draft, knownSegmentIds)) continue;
    if (isDuplicateSummary(draft.summary, notedSoFar)) continue;
    newDrafts.push(draft);
    notedSoFar.push(draft.summary);
  }
  return newDrafts;
}

/**
 * Simple word-overlap (Jaccard) similarity check: catches Claude re-phrasing
 * the same underlying blocker/decision slightly differently between calls
 * (e.g. "Group still sees a 500 error" vs. "The group is still hitting a 500
 * error"), which an exact case-insensitive string match — the previous
 * check — never catches. Not a semantic/embedding comparison, just a
 * pragmatic, dependency-free improvement over exact matching.
 */
function isDuplicateSummary(candidate: string, existing: string[]): boolean {
  const candidateWords = summaryWords(candidate);
  if (candidateWords.size === 0) return false;
  return existing.some((summary) => {
    const existingWords = summaryWords(summary);
    if (existingWords.size === 0) return false;
    const intersectionSize = [...candidateWords].filter((word) => existingWords.has(word)).length;
    const unionSize = new Set([...candidateWords, ...existingWords]).size;
    return intersectionSize / unionSize >= DUPLICATE_SUMMARY_SIMILARITY;
  });
}

function summaryWords(summary: string): Set<string> {
  return new Set(
    summary
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, "")
      .split(/\s+/)
      .filter(Boolean),
  );
}
