import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { hasFacilitatorAccess, learnerParticipantId } from "@/lib/session-access";
import { roomProvider, type RoomRole } from "@/lib/providers/room";

function isRequestedRole(value: unknown): value is RoomRole {
  return value === "facilitator" || value === "learner";
}

export async function POST(request: NextRequest) {
  if (!roomProvider.isConfigured) {
    return Response.json({ error: "LiveKit is not configured." }, { status: 503 });
  }

  const body = (await request.json()) as { sessionId?: unknown; role?: unknown };
  if (typeof body.sessionId !== "string" || !isRequestedRole(body.role)) {
    return Response.json({ error: "Invalid room request." }, { status: 400 });
  }

  const session = await prisma.session.findUnique({ where: { id: body.sessionId } });
  if (!session) return Response.json({ error: "Session not found." }, { status: 404 });

  let identity: string;
  let name: string;
  if (body.role === "facilitator") {
    if (!(await hasFacilitatorAccess(session.id))) {
      return Response.json({ error: "Not authorized for this facilitator room." }, { status: 403 });
    }
    const facilitator = await prisma.user.findUnique({ where: { id: session.facilitatorId } });
    if (!facilitator) return Response.json({ error: "Facilitator not found." }, { status: 404 });
    identity = facilitator.id;
    name = facilitator.displayName;
  } else {
    const participantId = await learnerParticipantId(session.id);
    if (!participantId) return Response.json({ error: "Not authorized for this learner room." }, { status: 403 });
    const participant = await prisma.sessionParticipant.findUnique({
      where: { id: participantId },
      include: { user: true },
    });
    if (!participant || participant.sessionId !== session.id) {
      return Response.json({ error: "Learner not found." }, { status: 404 });
    }
    identity = participant.id;
    name = participant.user.displayName;
  }

  const credential = await roomProvider.issueCredential({
    sessionId: session.id,
    role: body.role,
    identity,
    displayName: name,
  });

  return Response.json(credential);
}
