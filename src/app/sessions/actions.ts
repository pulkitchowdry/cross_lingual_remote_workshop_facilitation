"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ParticipantRole, SessionStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { hasFacilitatorAccess, learnerParticipantId } from "@/lib/session-access";
import { CHAT_MESSAGE_MAX_LENGTH, SUPPORTED_LANGUAGES, type FormActionResult, type SupportedLanguage } from "@/lib/session-contracts";
import { translateText } from "@/lib/providers/translation";
import { isRateLimited } from "@/lib/rate-limit";
import { isPrivateMessageRequest, validateFacilitatorPrivateRecipient } from "@/lib/message-visibility";
import { buildGlossaryPromptHint, findGlossaryMatches, type CentralGlossaryEntryLike } from "@/lib/glossary";
import { isSessionRetentionExpired } from "@/lib/session-retention";

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
  if (typeof text !== "string" || !text.trim() || text.trim().length > CHAT_MESSAGE_MAX_LENGTH) {
    return { error: `Enter a message of up to ${CHAT_MESSAGE_MAX_LENGTH.toLocaleString()} characters.` };
  }
  const kind = formData.get("kind") === "QUESTION" ? "QUESTION" : "CHAT";
  const isAnonymous = role === "learner" && formData.get("isAnonymous") === "true";
  const isPrivateMessage = isPrivateMessageRequest(role, formData);

  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) redirect("/setup");
  if (session.status !== SessionStatus.LIVE) {
    return { error: "This session is not live — messages can only be sent while it is in progress." };
  }

  let senderId: string;
  let sourceLanguage: SupportedLanguage;
  let recipientId: string | null = null;
  if (role === "facilitator") {
    if (!(await hasFacilitatorAccess(sessionId))) redirect("/setup");
    const participant = await prisma.sessionParticipant.findFirst({
      where: { sessionId, userId: session.facilitatorId, role: ParticipantRole.FACILITATOR },
      select: { id: true },
    });
    if (!participant) redirect("/setup");
    senderId = session.facilitatorId;
    sourceLanguage = session.sourceLanguage as SupportedLanguage;
    if (isPrivateMessage) {
      const recipientParticipantId = formData.get("recipientParticipantId");
      if (typeof recipientParticipantId !== "string" || !recipientParticipantId.trim()) {
        return { error: "Choose a learner in this session for a private reply." };
      }
      const recipientParticipant = await prisma.sessionParticipant.findFirst({
        where: { id: recipientParticipantId, sessionId },
        select: { id: true, userId: true, role: true, sessionId: true },
      });
      const validated = validateFacilitatorPrivateRecipient({ participant: recipientParticipant, sessionId });
      if (validated.error) return { error: validated.error };
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
    if (isPrivateMessage) {
      const requestedRecipient = formData.get("recipientParticipantId");
      if (typeof requestedRecipient === "string" && requestedRecipient.trim()) {
        return { error: "Learners can only message the facilitator privately." };
      }
      recipientId = session.facilitatorId;
    }
  }

  // Keyed by the real, already-authenticated sender identity (not a raw cookie or IP),
  // so it throttles a single script hammering this action as one specific
  // facilitator/learner rather than needing to guess a request-level identity.
  if (isRateLimited(`chat:${senderId}`, CHAT_RATE_LIMIT.max, CHAT_RATE_LIMIT.windowMs)) {
    return { error: "You're sending messages too quickly. Please wait a moment and try again." };
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
    return { error: "This session is not live — messages can only be sent while it is in progress." };
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
 * Debounced full-scene snapshot save (see Whiteboard.tsx) — purely for
 * late-joiners/page reloads, not the live-sync path (the "whiteboard"
 * LiveKit DataChannel topic). Upserted, one row per session.
 */
export async function saveWhiteboardSnapshot(sessionId: string, elements: unknown[]) {
  const isFacilitator = await hasFacilitatorAccess(sessionId);
  const isLearner = Boolean(await learnerParticipantId(sessionId));
  if (!isFacilitator && !isLearner) redirect("/setup");

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
