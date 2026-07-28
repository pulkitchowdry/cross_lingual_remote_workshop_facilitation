import { NextRequest } from "next/server";
import { SessionStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { hasFacilitatorAccess, learnerParticipantId } from "@/lib/session-access";
import { roomProvider, type RoomRole } from "@/lib/providers/room";
import { resolveLanguage } from "@/lib/i18n";

function isRequestedRole(value: unknown): value is RoomRole {
  return value === "facilitator" || value === "learner";
}

export async function POST(request: NextRequest) {
  if (!roomProvider.isConfigured) {
    return Response.json({ error: "LiveKit is not configured." }, { status: 503 });
  }

  let body: { sessionId?: unknown; role?: unknown; raisedHand?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid room request." }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "Invalid room request." }, { status: 400 });
  }
  if (typeof body.sessionId !== "string" || !isRequestedRole(body.role)) {
    return Response.json({ error: "Invalid room request." }, { status: 400 });
  }

  const session = await prisma.session.findUnique({ where: { id: body.sessionId } });
  if (!session) return Response.json({ error: "Session not found." }, { status: 404 });
  if (session.status !== SessionStatus.LIVE) {
    return Response.json({ error: "Session is not live." }, { status: 409 });
  }

  let identity: string;
  let name: string;
  let preferredLanguage: string;
  if (body.role === "facilitator") {
    if (!(await hasFacilitatorAccess(session.id))) {
      return Response.json({ error: "Not authorized for this facilitator room." }, { status: 403 });
    }
    const facilitator = await prisma.user.findUnique({ where: { id: session.facilitatorId } });
    if (!facilitator) return Response.json({ error: "Facilitator not found." }, { status: 404 });
    identity = facilitator.id;
    name = facilitator.displayName;
    preferredLanguage = session.sourceLanguage;
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
    preferredLanguage = participant.preferredLanguage;
  }

  const credential = await roomProvider.issueCredential({
    sessionId: session.id,
    role: body.role,
    identity,
    displayName: name,
    preferredLanguage: resolveLanguage(preferredLanguage),
    // The client sends back whatever its local participant's raisedHand attribute
    // currently is (see LiveSessionRoom.tsx's RaisedHandTracker) — a background
    // token refresh mints a brand-new token, and without this every refresh
    // silently reset raisedHand to issueCredential's own "false" default even if
    // the participant's hand was actually still up.
    raisedHand: body.raisedHand === true,
  });

  return Response.json(credential);
}
