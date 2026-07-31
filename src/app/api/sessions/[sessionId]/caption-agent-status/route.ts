import { prisma } from "@/lib/db";
import { hasFacilitatorAccess, learnerParticipantId } from "@/lib/session-access";
import { isSessionRetentionExpired } from "@/lib/session-retention";
import { getAgentDispatchStatus } from "@/lib/providers/room";
import { agentCaptures } from "@/lib/caption-capture-mode";

/**
 * Polled by the captions tab UI (see use-caption-agent-status.ts) to show a pending/
 * connected/failed indicator for the server-side caption agent instead of silence — a
 * general UX signal for facilitator and learner alike, not just the facilitator, since a
 * learner reading captions cares just as much whether the pipeline producing them is
 * actually working. See docs/CAPTION_AUDIO_TROUBLESHOOTING.md §12 for the dispatch-
 * delivery gap this is ultimately surfacing.
 *
 * `getAgentDispatchStatus`'s underlying retry loop (room.ts) checks "has *any* agent
 * participant joined this room" — already role-agnostic, not facilitator-specific — so
 * the only facilitator-scoped piece here is `session.captionAgentActive`, folded in
 * below as an earlier/stronger "yes it's working" signal (it means the facilitator's own
 * audio track is actually flowing, which can land before the room-membership check above
 * next polls).
 *
 * `agentCaptures("facilitator")` (env-driven, server-only — a client component can't read
 * `CAPTION_CAPTURE_MODE` directly) decides whether this indicator is even meaningful for
 * this deployment; checked here rather than threading a separate prop through every
 * intermediate component down to `MeetingSidebar`, since the client side only needs to
 * poll unconditionally and let this route say "not applicable" otherwise (e.g.
 * `browser-only` mode, where there's no agent to report on at all).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;

  const isFacilitator = await hasFacilitatorAccess(sessionId);
  const isLearner = Boolean(await learnerParticipantId(sessionId));
  if (!isFacilitator && !isLearner) {
    return Response.json({ error: "Not authorized for this session." }, { status: 403 });
  }

  if (!agentCaptures("facilitator")) {
    return Response.json({ status: "not-applicable" });
  }

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { captionAgentActive: true, status: true, createdAt: true, startedAt: true, endedAt: true, retentionDays: true },
  });
  if (!session || isSessionRetentionExpired(session)) {
    return Response.json({ error: "This session's data is no longer available." }, { status: 404 });
  }

  const dispatchStatus = getAgentDispatchStatus(sessionId);
  const status = session.captionAgentActive ? "connected" : dispatchStatus;
  return Response.json({ status });
}
