import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { insightProvider, validateInsightDraft } from "@/lib/providers/insight";
import type { Session } from "@/generated/prisma/client";

const CONTEXT_WINDOW = 20;

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
 */
export async function generateSessionInsights(session: Session): Promise<void> {
  if (!insightProvider.isConfigured) return;

  try {
    const recentSegments = await prisma.transcriptSegment.findMany({
      where: { sessionId: session.id, isFinal: true },
      orderBy: { startedAt: "desc" },
      take: CONTEXT_WINDOW,
      select: { id: true, originalText: true },
    });
    if (recentSegments.length === 0) return;

    const existingInsights = await prisma.insight.findMany({
      where: { sessionId: session.id },
      select: { summary: true },
    });
    const alreadyNoted = existingInsights.map((insight) => insight.summary);
    const alreadyNotedKeys = new Set(alreadyNoted.map((summary) => summary.trim().toLowerCase()));

    const drafts = await insightProvider.generateInsights({
      sessionGoal: session.goal,
      finalSegments: recentSegments.map((segment) => ({ id: segment.id, originalText: segment.originalText })),
      alreadyNoted,
    });

    const knownSegmentIds = new Set(recentSegments.map((segment) => segment.id));
    const newDrafts = drafts.filter(
      (draft) =>
        validateInsightDraft(draft, knownSegmentIds) && !alreadyNotedKeys.has(draft.summary.trim().toLowerCase()),
    );
    if (newDrafts.length === 0) return;

    for (const draft of newDrafts) {
      await prisma.insight.create({
        data: {
          sessionId: session.id,
          type: draft.type,
          summary: draft.summary,
          evidence: { createMany: { data: draft.sourceSegmentIds.map((id) => ({ transcriptSegmentId: id })) } },
        },
      });
    }

    revalidatePath(`/sessions/${session.id}/facilitator`);
  } catch {
    // Best-effort background analysis — never let this affect the live caption path.
  }
}
