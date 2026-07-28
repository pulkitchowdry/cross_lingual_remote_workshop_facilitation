import { Prisma } from "@/generated/prisma/client";
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
  // Case-insensitive, same as CentralGlossaryEntry dedup (see glossary.ts's
  // findGlossaryMatches) — without this, e.g. "GPT4" and "Gpt4" across two captions in
  // the same session created two separate suggestion rows instead of accumulating into one.
  const sourceTerm = term.toLowerCase();
  try {
    // `create` first, not the old check-then-act (updateMany, then conditionally
    // upsert) — two concurrent calls for the same brand-new term both used to see 0
    // rows from that updateMany (the row didn't exist yet), then race each other's
    // upsert: the loser's `create` branch hit the unique constraint and fell into a
    // no-op `update: {}`, silently losing its increment. A `create` is atomic at the DB
    // level, so at most one caller wins it; the other catches the unique-constraint
    // violation below and does the increment instead.
    await prisma.glossarySuggestion.create({ data: { sessionId, sourceTerm } });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      // Best-effort — a suggestion-tracking failure must never break live captioning.
      console.error(`recordUnknownGlossaryTerms failed for "${term}"`, error);
      return;
    }
    try {
      await prisma.glossarySuggestion.updateMany({
        where: { sessionId, sourceTerm, status: "PENDING" },
        data: { occurrenceCount: { increment: 1 }, lastSeenAt: new Date() },
      });
    } catch (updateError) {
      console.error(`recordUnknownGlossaryTerms failed for "${term}"`, updateError);
    }
  }
}
