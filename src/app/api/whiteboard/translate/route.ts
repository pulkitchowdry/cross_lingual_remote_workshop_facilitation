import { NextRequest } from "next/server";
import { RoomServiceClient } from "livekit-server-sdk";
import { prisma } from "@/lib/db";
import { hasFacilitatorAccess, learnerParticipantId } from "@/lib/session-access";
import { translateText } from "@/lib/providers/translation";
import { roomProvider } from "@/lib/providers/room";
import { isSessionRetentionExpired } from "@/lib/session-retention";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/lib/session-contracts";
import { SessionStatus } from "@/generated/prisma/client";
import { parseRoomMetadata } from "@/components/meeting/room-metadata";
import { buildGlossaryPromptHint, findGlossaryMatches, type CentralGlossaryEntryLike } from "@/lib/glossary";

function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return SUPPORTED_LANGUAGES.some((lang) => lang.value === value);
}

/**
 * Whether a learner currently has presenting rights — the same `allowLearnerPresenting`
 * check Whiteboard.tsx/MeetingRoom.tsx make client-side via useRoomInfo() + parseRoomMetadata
 * before letting a learner edit at all. `allowLearnerPresenting` is a live LiveKit
 * room-metadata toggle (see roomProvider.setPresenterAccess in src/lib/providers/room.ts), not
 * a Prisma column, and RoomProvider doesn't expose a getter for it — reading it directly here,
 * scoped to this route, so a learner without presenting rights can't bypass the client-side
 * gate by POSTing straight to this endpoint.
 */
async function learnerCanPresent(sessionId: string): Promise<boolean> {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const serverUrl = process.env.LIVEKIT_AGENT_URL || process.env.LIVEKIT_URL;
  if (!apiKey || !apiSecret || !serverUrl) return false;
  try {
    const client = new RoomServiceClient(serverUrl, apiKey, apiSecret);
    const [room] = await client.listRooms([`workshop-${sessionId}`]);
    return parseRoomMetadata(room?.metadata).allowLearnerPresenting;
  } catch (error) {
    console.error(`learnerCanPresent: LiveKit listRooms failed for session ${sessionId}:`, error);
    return false;
  }
}

/**
 * Translates a whiteboard text element into every other supported language
 * once its edit has settled (debounced client-side — see Whiteboard.tsx), and
 * broadcasts the result to the room over the same "whiteboard" DataChannel
 * topic clients use for their own live drawing sync (roomProvider.
 * sendWhiteboardUpdate) — this is the one whiteboard update that must come
 * from the server, since translateText is server-only.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    sessionId?: unknown;
    elementId?: unknown;
    sourceText?: unknown;
    sourceLanguage?: unknown;
  };
  if (
    typeof body.sessionId !== "string" ||
    typeof body.elementId !== "string" ||
    typeof body.sourceText !== "string" ||
    !isSupportedLanguage(body.sourceLanguage)
  ) {
    return Response.json({ error: "Invalid whiteboard translation request." }, { status: 400 });
  }
  const { sessionId, elementId, sourceText, sourceLanguage } = body;

  const isFacilitator = await hasFacilitatorAccess(sessionId);
  const isLearner = Boolean(await learnerParticipantId(sessionId));
  if (!isFacilitator && !isLearner) {
    return Response.json({ error: "Not authorized for this session." }, { status: 403 });
  }
  // Whiteboard.tsx only lets a learner without presenting rights view text (never edit it),
  // gated client-side by `canPresent`/`viewModeEnabled` — without this, a learner without
  // presenting rights could bypass that gate entirely by POSTing straight to this route.
  if (!isFacilitator && !(await learnerCanPresent(sessionId))) {
    return Response.json({ error: "You do not have presenting rights for this session." }, { status: 403 });
  }

  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) return Response.json({ error: "Session not found." }, { status: 404 });
  // Mirrors publishTranslatedCaption's late re-check in src/lib/captions.ts (a
  // translation call can take several seconds, long enough for the facilitator to end
  // the session while it's in flight) and the retention check every other route
  // serving session content applies — without both, a still-valid facilitator/learner
  // cookie could trigger a paid translation call and a live room broadcast for a
  // session that has already ended or is past its own retention deadline.
  if (session.status !== SessionStatus.LIVE || isSessionRetentionExpired(session)) {
    return Response.json({ error: "This session is no longer available." }, { status: 404 });
  }

  const allowCloudFallback = session.translationMode !== "LOCAL_ONLY";
  // Central Technical Glossary lookup (issue #131) — mirrors publishTranslatedCaption's
  // own glossary pass in src/lib/captions.ts and sendChatMessage's in
  // src/app/sessions/actions.ts. Without this, a facilitator's curated glossary entries
  // (e.g. a term marked "keep verbatim", or one with a specific preferred zh/es rendering)
  // were honored in captions/chat but silently ignored the moment the same term appeared
  // on the whiteboard, so the identical term could translate differently depending on
  // which surface it was typed into within the same session.
  const centralGlossary = await prisma.centralGlossaryEntry.findMany({
    select: { sourceTerm: true, translate: true, translations: true },
  });
  const centralGlossaryEntries: CentralGlossaryEntryLike[] = centralGlossary.map((entry) => ({
    sourceTerm: entry.sourceTerm,
    translate: entry.translate,
    translations: (entry.translations as Record<string, string>) ?? {},
  }));
  const glossaryMatches = findGlossaryMatches(sourceText, centralGlossaryEntries);
  const translations: Partial<Record<SupportedLanguage, string>> = {};
  await Promise.all(
    SUPPORTED_LANGUAGES.filter((lang) => lang.value !== sourceLanguage).map(async ({ value: target }) => {
      const glossaryHint = buildGlossaryPromptHint(glossaryMatches, target);
      const result = await translateText(sourceText, sourceLanguage, target, { allowCloudFallback, glossaryHint });
      if (result) translations[target] = result.text;
    }),
  );

  // Late re-check, right before broadcasting/persisting — mirrors publishTranslatedCaption's
  // own re-check in src/lib/captions.ts. The translation batch above can take several
  // seconds, long enough for the facilitator to end the session while it's in flight; the
  // check at the top of this function alone isn't enough to prevent a broadcast into an
  // already-ended (or now retention-expired) session.
  const stillLive = await prisma.session.findUnique({ where: { id: sessionId }, select: { status: true } });
  if (!stillLive || stillLive.status !== SessionStatus.LIVE) {
    return Response.json({ error: "This session is no longer available." }, { status: 404 });
  }

  const customData = { sourceLanguage, sourceText, translations };
  await roomProvider.sendWhiteboardUpdate(sessionId, [{ id: elementId, customData }]);

  return Response.json({ elementId, customData });
}
