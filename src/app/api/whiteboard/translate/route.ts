import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { hasFacilitatorAccess, learnerParticipantId } from "@/lib/session-access";
import { translateText } from "@/lib/providers/translation";
import { roomProvider } from "@/lib/providers/room";
import { isSessionRetentionExpired } from "@/lib/session-retention";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/lib/session-contracts";
import { SessionStatus } from "@/generated/prisma/client";

function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return SUPPORTED_LANGUAGES.some((lang) => lang.value === value);
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
  const translations: Partial<Record<SupportedLanguage, string>> = {};
  await Promise.all(
    SUPPORTED_LANGUAGES.filter((lang) => lang.value !== sourceLanguage).map(async ({ value: target }) => {
      const result = await translateText(sourceText, sourceLanguage, target, { allowCloudFallback });
      if (result) translations[target] = result.text;
    }),
  );

  const customData = { sourceLanguage, sourceText, translations };
  await roomProvider.sendWhiteboardUpdate(sessionId, [{ id: elementId, customData }]);

  return Response.json({ elementId, customData });
}
