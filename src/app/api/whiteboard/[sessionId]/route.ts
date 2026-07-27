import { prisma } from "@/lib/db";
import { hasFacilitatorAccess, learnerParticipantId } from "@/lib/session-access";
import { isSessionRetentionExpired } from "@/lib/session-retention";

/**
 * Returns the current whiteboard snapshot for late-joiners/page reloads —
 * the live-sync path is the "whiteboard" LiveKit DataChannel topic
 * (see Whiteboard.tsx), not this route; this only covers the gap between
 * "just mounted the canvas" and "first live update arrives."
 */
export async function GET(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;

  const isFacilitator = await hasFacilitatorAccess(sessionId);
  const isLearner = Boolean(await learnerParticipantId(sessionId));
  if (!isFacilitator && !isLearner) {
    return Response.json({ error: "Not authorized for this session." }, { status: 403 });
  }

  // Matches the retention check every other route serving session content applies
  // (e.g. the captions audio route) — without it, a facilitator/learner holding a
  // still-valid cookie could keep fetching the whiteboard snapshot past the
  // session's own configured deletion deadline, for as long as the cleanup cron
  // just hasn't physically deleted the row yet.
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { status: true, createdAt: true, startedAt: true, endedAt: true, retentionDays: true },
  });
  if (!session || isSessionRetentionExpired(session)) {
    return Response.json({ error: "This session's data is no longer available." }, { status: 404 });
  }

  const snapshot = await prisma.whiteboardSnapshot.findUnique({ where: { sessionId } });
  return Response.json({ elements: snapshot?.elements ?? [] });
}
