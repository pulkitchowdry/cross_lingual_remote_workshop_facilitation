import { prisma } from "@/lib/db";
import { hasFacilitatorAccess, learnerParticipantId } from "@/lib/session-access";

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

  const snapshot = await prisma.whiteboardSnapshot.findUnique({ where: { sessionId } });
  return Response.json({ elements: snapshot?.elements ?? [] });
}
