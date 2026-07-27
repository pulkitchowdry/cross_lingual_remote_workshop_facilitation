import { prisma } from "@/lib/db";
import { safeRevalidatePath } from "@/lib/safe-revalidate";
import { insightProvider, validateInsightDraft, type InsightDraft } from "@/lib/providers/insight";
import type { Session } from "@/generated/prisma/client";
import type { SupportedLanguage } from "@/lib/session-contracts";
import { publicSessionMessageWhere } from "@/lib/message-visibility";

const CONTEXT_WINDOW = 20;
/**
 * Word-overlap (Jaccard) threshold strictly above which a new draft is treated as a
 * paraphrase of an already-noted insight, not genuinely new. Strictly `>`, not `>=` —
 * see `isDuplicateSummary`'s doc comment for why a tie at exactly this value shouldn't
 * auto-classify as a duplicate.
 */
const DUPLICATE_SUMMARY_SIMILARITY = 0.6;
/**
 * Function/filler words excluded before computing word overlap. Two insights sharing a
 * formulaic template but differing in their actual, distinguishing content word (e.g.
 * "Group decided to use JWT for auth" vs. "Group decided to use OAuth for auth" — a
 * genuine decision reversal, not a paraphrase) can otherwise cross
 * `DUPLICATE_SUMMARY_SIMILARITY` purely on shared "group"/"decided"/"to"/"use"/"for",
 * silently dropping the second, genuinely new insight with no error or trace. Not
 * exhaustive — just enough to stop the most common shared scaffolding words Claude's
 * own summary phrasing repeats across otherwise-unrelated insights.
 */
const SUMMARY_STOPWORDS = new Set([
  "a", "an", "the", "to", "for", "of", "is", "are", "on", "in", "at", "by", "and", "or",
  "with", "was", "were", "be", "been", "it", "its", "this", "that", "group", "session",
]);
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

        safeRevalidatePath(`/sessions/${session.id}/facilitator`);
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
 *
 * Computed over content words only (`SUMMARY_STOPWORDS` filtered out first) — Claude's
 * own summaries follow a small set of repeated templates ("Group decided to use X for
 * Y", "Group still sees Z"), so two summaries about clearly different, even
 * contradictory, facts (a decision reversal from JWT to OAuth, say) can otherwise share
 * enough bare function words to look like a paraphrase of each other. `>`, not `>=` —
 * a tie sitting exactly at the threshold is exactly the boundary case that motivated
 * this fix in the first place (see SUMMARY_STOPWORDS' doc comment for the worked
 * example), so it shouldn't itself auto-classify as a duplicate.
 */
function isDuplicateSummary(candidate: string, existing: string[]): boolean {
  const candidateWords = summaryWords(candidate);
  if (candidateWords.size === 0) return false;
  return existing.some((summary) => {
    const existingWords = summaryWords(summary);
    if (existingWords.size === 0) return false;
    const intersectionSize = [...candidateWords].filter((word) => existingWords.has(word)).length;
    const unionSize = new Set([...candidateWords, ...existingWords]).size;
    return intersectionSize / unionSize > DUPLICATE_SUMMARY_SIMILARITY;
  });
}

function summaryWords(summary: string): Set<string> {
  return new Set(
    summary
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, "")
      .split(/\s+/)
      .filter((word) => word.length > 0 && !SUMMARY_STOPWORDS.has(word)),
  );
}

/**
 * One-time, end-of-session call — affordable to read much more of the transcript than
 * the live per-caption CONTEXT_WINDOW (20), but still capped: an unbounded read of a
 * very long workshop's full transcript would make this call's token cost/latency grow
 * without limit. 300 segments comfortably covers a full multi-hour session in practice.
 */
const SUMMARY_TRANSCRIPT_LIMIT = 300;

/**
 * Generates and persists the once-per-session "AI Session Summary" FEATURE_LIST.md
 * promises (important questions, misunderstood topics, participation, suggested
 * improvements) — called fire-and-forget from `endSession()` (facilitator/actions.ts),
 * the same pattern `generateSessionInsights` already uses from `publishTranslatedCaption`:
 * this app runs a persistent Node process (server.ts), not a Vercel Function, so a plain
 * unawaited call safely outlives the request with no `waitUntil` needed. Every failure
 * mode (no API key, network error, malformed response) degrades to leaving
 * `Session.summary` at its `null` default — a missing summary is far less harmful than
 * making "End session" itself slow or fail.
 */
export async function generateAndPersistSessionSummary(session: Session): Promise<void> {
  if (!insightProvider.isConfigured) return;
  // Same cloud-only constraint as generateSessionInsights: a strict-privacy (LOCAL_ONLY)
  // session must never have its transcript sent to Claude, and InsightProvider has no
  // local-inference tier to fall back to instead.
  if (session.translationMode === "LOCAL_ONLY") return;

  try {
    const [transcriptSegments, messages, participantCount] = await Promise.all([
      // `desc` + `take` grabs the most recent SUMMARY_TRANSCRIPT_LIMIT segments; reversed
      // below to chronological order before joining into prose, the same reasoning as
      // generateSessionInsights' own reversal (reading events in the order they actually
      // happened, not most-recent-first).
      prisma.transcriptSegment.findMany({
        where: { sessionId: session.id, isFinal: true },
        orderBy: { startedAt: "desc" },
        take: SUMMARY_TRANSCRIPT_LIMIT,
        select: { originalText: true },
      }),
      prisma.message.findMany({
        where: publicSessionMessageWhere(session.id),
        select: { kind: true, originalText: true },
      }),
      prisma.sessionParticipant.count({ where: { sessionId: session.id, role: "LEARNER" } }),
    ]);
    if (transcriptSegments.length === 0) return;

    const transcriptText = [...transcriptSegments].reverse().map((segment) => segment.originalText).join("\n");
    const learnerQuestions = messages.filter((message) => message.kind === "QUESTION").map((message) => message.originalText);

    const summary = await insightProvider.generateSessionSummary({
      sessionGoal: session.goal,
      sourceLanguage: session.sourceLanguage as SupportedLanguage,
      transcriptText,
      learnerQuestions,
      participantCount,
      messageCount: messages.length,
      questionCount: learnerQuestions.length,
    });
    if (!summary) return;

    await prisma.session.update({ where: { id: session.id }, data: { summary } });
    safeRevalidatePath(`/sessions/${session.id}/facilitator`);
    safeRevalidatePath(`/sessions/${session.id}/learn`);
  } catch (error) {
    console.error("generateAndPersistSessionSummary failed", error);
  }
}
