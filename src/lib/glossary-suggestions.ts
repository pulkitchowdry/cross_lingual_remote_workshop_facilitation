import { prisma } from "@/lib/db";
import { detectCandidateTerms } from "@/lib/glossary";

/**
 * Detects and upserts unknown-technical-term candidates for a transcript
 * segment (issue #131's "Record unknown technical terms during meetings").
 * Fire-and-forget from publishTranslatedCaption, same pattern as
 * generateSessionInsights below it — a facilitator reviews these on the
 * ended-session dashboard (see GlossarySuggestions component), not live.
 */
export async function recordUnknownGlossaryTerms(
  sessionId: string,
  originalText: string,
  knownTerms: Set<string>,
): Promise<void> {
  const candidates = detectCandidateTerms(originalText, knownTerms);
  if (candidates.length === 0) return;

  await Promise.all(candidates.map((term) => upsertPendingSuggestion(sessionId, term)));
}

/**
 * Only PENDING suggestions accumulate an occurrence count — a facilitator who
 * already approved or ignored this term for the session shouldn't have that
 * decision silently reverted just because it comes up again later in the same
 * meeting, so an existing APPROVED/IGNORED row is left untouched.
 */
async function upsertPendingSuggestion(sessionId: string, term: string): Promise<void> {
  try {
    const { count } = await prisma.glossarySuggestion.updateMany({
      where: { sessionId, sourceTerm: term, status: "PENDING" },
      data: { occurrenceCount: { increment: 1 }, lastSeenAt: new Date() },
    });
    if (count === 0) {
      await prisma.glossarySuggestion.upsert({
        where: { sessionId_sourceTerm: { sessionId, sourceTerm: term } },
        update: {},
        create: { sessionId, sourceTerm: term },
      });
    }
  } catch (error) {
    // Best-effort — a suggestion-tracking failure must never break live captioning.
    console.error(`recordUnknownGlossaryTerms failed for "${term}"`, error);
  }
}
