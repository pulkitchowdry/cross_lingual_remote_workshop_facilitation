"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { RoomServiceClient } from "livekit-server-sdk";
import { ParticipantRole, SessionStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { hasFacilitatorAccess, learnerParticipantId } from "@/lib/session-access";
import { CHAT_MESSAGE_MAX_LENGTH, SUPPORTED_LANGUAGES, type FormActionResult, type SupportedLanguage } from "@/lib/session-contracts";
import { translateText } from "@/lib/providers/translation";
import { isRateLimited } from "@/lib/rate-limit";
import { isPrivateMessageRequest, validateFacilitatorPrivateRecipient } from "@/lib/message-visibility";
import { buildGlossaryPromptHint, findGlossaryMatches, type CentralGlossaryEntryLike } from "@/lib/glossary";
import { isSessionRetentionExpired } from "@/lib/session-retention";
import { getDictionary, type Dictionary } from "@/lib/i18n";
import { parseRoomMetadata } from "@/components/meeting/room-metadata";

type ChatRole = "facilitator" | "learner";

/** 10 messages per 10s per sender — comfortably above real typing/sending speed, but
 * bounds a script that bypasses the UI and POSTs directly to this action from fanning
 * out unlimited paid per-language Claude/local-inference translation calls. */
const CHAT_RATE_LIMIT = { max: 10, windowMs: 10_000 };

export async function sendChatMessage(
  sessionId: string,
  role: ChatRole,
  _prevState: FormActionResult,
  formData: FormData,
): Promise<FormActionResult> {
  const text = formData.get("message");
  const kind = formData.get("kind") === "QUESTION" ? "QUESTION" : "CHAT";
  const isAnonymous = role === "learner" && formData.get("isAnonymous") === "true";
  const isPrivateMessage = isPrivateMessageRequest(role, formData);

  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) redirect("/setup");

  let senderId: string;
  let sourceLanguage: SupportedLanguage;
  let recipientId: string | null = null;
  // Localized via the *sender's own* resolved language, not the viewer's page language
  // — a facilitator and a learner in the same room can be on different languages, and
  // each should see their own action's errors in their own, not always English (see
  // dict.chatErrors's own doc comment in i18n.ts). Set as soon as sourceLanguage is
  // known in each branch below, so it's available for that branch's own error returns
  // too (e.g. the private-recipient checks), not just the ones after this if/else.
  let chatErrors: Dictionary["chatErrors"];
  if (role === "facilitator") {
    if (!(await hasFacilitatorAccess(sessionId))) redirect("/setup");
    const participant = await prisma.sessionParticipant.findFirst({
      where: { sessionId, userId: session.facilitatorId, role: ParticipantRole.FACILITATOR },
      select: { id: true },
    });
    if (!participant) redirect("/setup");
    senderId = session.facilitatorId;
    sourceLanguage = session.sourceLanguage as SupportedLanguage;
    chatErrors = getDictionary(sourceLanguage).chatErrors;
    if (isPrivateMessage) {
      const recipientParticipantId = formData.get("recipientParticipantId");
      if (typeof recipientParticipantId !== "string" || !recipientParticipantId.trim()) {
        return { error: chatErrors.choosePrivateRecipient };
      }
      const recipientParticipant = await prisma.sessionParticipant.findFirst({
        where: { id: recipientParticipantId, sessionId },
        select: { id: true, userId: true, role: true, sessionId: true },
      });
      const validated = validateFacilitatorPrivateRecipient({ participant: recipientParticipant, sessionId });
      if (!validated.recipientId) return { error: chatErrors.choosePrivateRecipient };
      recipientId = validated.recipientId;
    }
  } else {
    const participantId = await learnerParticipantId(sessionId);
    if (!participantId) redirect("/setup");
    const participant = await prisma.sessionParticipant.findFirst({
      where: { id: participantId, sessionId, role: ParticipantRole.LEARNER },
    });
    if (!participant) redirect("/setup");
    senderId = participant.userId;
    sourceLanguage = participant.preferredLanguage as SupportedLanguage;
    chatErrors = getDictionary(sourceLanguage).chatErrors;
    if (isPrivateMessage) {
      const requestedRecipient = formData.get("recipientParticipantId");
      if (typeof requestedRecipient === "string" && requestedRecipient.trim()) {
        return { error: chatErrors.learnerPrivateRecipientRestricted };
      }
      recipientId = session.facilitatorId;
    }
  }

  if (session.status !== SessionStatus.LIVE) {
    return { error: chatErrors.sessionNotLive };
  }
  if (typeof text !== "string" || !text.trim() || text.trim().length > CHAT_MESSAGE_MAX_LENGTH) {
    return { error: chatErrors.messageTooLong(CHAT_MESSAGE_MAX_LENGTH) };
  }

  // Keyed by the real, already-authenticated sender identity (not a raw cookie or IP),
  // so it throttles a single script hammering this action as one specific
  // facilitator/learner rather than needing to guess a request-level identity.
  if (isRateLimited(`chat:${senderId}`, CHAT_RATE_LIMIT.max, CHAT_RATE_LIMIT.windowMs)) {
    return { error: chatErrors.rateLimited };
  }

  const allowCloudFallback = session.translationMode !== "LOCAL_ONLY";
  const targetLanguages = SUPPORTED_LANGUAGES.map((language) => language.value);
  // Central Technical Glossary lookup (issue #131) — mirrors publishTranslatedCaption's
  // own glossary pass in src/lib/captions.ts. Without this, a facilitator's curated
  // glossary entries (e.g. a term marked "keep verbatim", or one with a specific
  // preferred zh/es rendering) were honored when spoken/typed as a caption but silently
  // ignored the moment the same term appeared in a chat/Q&A message.
  const centralGlossary = await prisma.centralGlossaryEntry.findMany({
    select: { sourceTerm: true, translate: true, translations: true },
  });
  const centralGlossaryEntries: CentralGlossaryEntryLike[] = centralGlossary.map((entry) => ({
    sourceTerm: entry.sourceTerm,
    translate: entry.translate,
    translations: (entry.translations as Record<string, string>) ?? {},
  }));
  const glossaryMatches = findGlossaryMatches(text.trim(), centralGlossaryEntries);
  const translations = await Promise.all(
    targetLanguages.map(async (targetLanguage) => {
      const glossaryHint = buildGlossaryPromptHint(glossaryMatches, targetLanguage);
      const result = await translateText(text.trim(), sourceLanguage, targetLanguage, { allowCloudFallback, glossaryHint });
      return result
        ? {
            targetLanguage,
            text: result.text,
            provider: result.provider,
            qualitySignal: result.qualitySignal,
          }
        : null;
    }),
  );

  // Re-check LIVE status right before persisting, not just at the top of this
  // function — the per-language translation loop above can take up to ~10s (local-
  // inference tried first, Claude as fallback), long enough for the facilitator to
  // click "End session" while a learner's message is still in flight. Without this,
  // the message would still get written into a session that had already ended by
  // the time this runs.
  const stillLive = await prisma.session.findUnique({ where: { id: sessionId }, select: { status: true } });
  if (!stillLive || stillLive.status !== SessionStatus.LIVE) {
    return { error: chatErrors.sessionNotLive };
  }

  await prisma.message.create({
    data: {
      sessionId,
      senderId,
      recipientId,
      originalText: text.trim(),
      language: sourceLanguage,
      kind,
      isAnonymous,
      translations: {
        create: translations.filter(
          (translation): translation is NonNullable<typeof translation> => translation !== null,
        ),
      },
    },
  });

  revalidatePath(`/sessions/${sessionId}/facilitator`);
  revalidatePath(`/sessions/${sessionId}/learn`);
  return { error: null };
}

/**
 * Whether a learner currently has presenting rights — mirrors the identical check
 * src/app/api/whiteboard/translate/route.ts makes for the same threat (a learner
 * without presenting rights bypassing the client-side gate by calling a whiteboard
 * write path directly). `allowLearnerPresenting` is a live LiveKit room-metadata
 * toggle (see roomProvider.setPresenterAccess in src/lib/providers/room.ts), not a
 * Prisma column, so it has to be read from LiveKit directly here too.
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
 * Debounced full-scene snapshot save (see Whiteboard.tsx) — purely for
 * late-joiners/page reloads, not the live-sync path (the "whiteboard"
 * LiveKit DataChannel topic). Upserted, one row per session.
 */
export async function saveWhiteboardSnapshot(sessionId: string, elements: unknown[]) {
  const isFacilitator = await hasFacilitatorAccess(sessionId);
  const isLearner = Boolean(await learnerParticipantId(sessionId));
  if (!isFacilitator && !isLearner) redirect("/setup");
  // Whiteboard.tsx only lets a learner without presenting rights view the board
  // (viewModeEnabled, never edit), and its live DataChannel path discards a broadcast
  // from a non-presenting learner — without this check, a learner could bypass both
  // entirely by calling this Server Action directly with an arbitrary `elements` array,
  // silently overwriting the single persisted snapshot the facilitator locked them out
  // of editing. No-op rather than redirect, matching the retention check below — this
  // is called fire-and-forget from a client-side debounce timer with no navigation to
  // redirect.
  if (!isFacilitator && !(await learnerCanPresent(sessionId))) return;

  // Matches the SessionStatus.LIVE + retention check the sibling whiteboard API routes
  // already apply (src/app/api/whiteboard/[sessionId]/route.ts and .../translate/route.ts)
  // — without it, a still-valid facilitator/learner cookie could keep auto-saving whiteboard
  // edits (every debounced edit calls this) into a session that has already ended or is past
  // its own configured retention deadline. No-op rather than redirect: this is called
  // fire-and-forget from a client-side debounce timer with no navigation to redirect.
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { status: true, createdAt: true, startedAt: true, endedAt: true, retentionDays: true },
  });
  if (!session || session.status !== SessionStatus.LIVE || isSessionRetentionExpired(session)) {
    return;
  }

  await prisma.whiteboardSnapshot.upsert({
    where: { sessionId },
    create: { sessionId, elements: elements as object },
    update: { elements: elements as object },
  });
}
