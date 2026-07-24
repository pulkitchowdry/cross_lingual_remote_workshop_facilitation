"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SessionStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { hasFacilitatorAccess } from "@/lib/session-access";
import { translateText } from "@/lib/providers/translation";
import { speechToTextProvider } from "@/lib/providers/speech-to-text";
import { roomProvider } from "@/lib/providers/room";
import type { Session } from "@/generated/prisma/client";
import type { SupportedLanguage } from "@/lib/session-contracts";

/** Translates `originalText` into every learner language and persists it as a transcript segment. */
async function persistTranslatedSegment(
  session: Session,
  input: { speakerId: string | null; originalText: string; language: SupportedLanguage; startedAt: Date; endedAt: Date },
) {
  const translations = await Promise.all(
    session.learnerLanguages.map(async (targetLanguage) => {
      const target = targetLanguage as SupportedLanguage;
      const result = await translateText(input.originalText, input.language, target);
      return result
        ? {
            targetLanguage: target,
            text: result.text,
            provider: result.provider,
            qualitySignal: result.qualitySignal,
          }
        : null;
    }),
  );

  await prisma.transcriptSegment.create({
    data: {
      sessionId: session.id,
      speakerId: input.speakerId,
      originalText: input.originalText,
      language: input.language,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      translations: {
        create: translations.filter(
          (translation): translation is NonNullable<typeof translation> => translation !== null,
        ),
      },
    },
  });
}

export async function startSession(sessionId: string) {
  if (!(await hasFacilitatorAccess(sessionId))) redirect("/setup");

  await prisma.session.update({
    where: { id: sessionId },
    data: { status: SessionStatus.LIVE, startedAt: new Date() },
  });
  revalidatePath(`/sessions/${sessionId}/facilitator`);
  revalidatePath(`/sessions/${sessionId}/learn`);
}

export async function endSession(sessionId: string) {
  if (!(await hasFacilitatorAccess(sessionId))) redirect("/setup");

  await prisma.session.update({
    where: { id: sessionId },
    data: { status: SessionStatus.ENDED, endedAt: new Date() },
  });
  revalidatePath(`/sessions/${sessionId}/facilitator`);
  revalidatePath(`/sessions/${sessionId}/learn`);
}

export async function loadDemoScenario(sessionId: string) {
  if (!(await hasFacilitatorAccess(sessionId))) redirect("/setup");

  const existingSegments = await prisma.transcriptSegment.count({ where: { sessionId } });
  if (existingSegments > 0) {
    revalidatePath(`/sessions/${sessionId}/facilitator`);
    return;
  }

  const startedAt = new Date();
  await prisma.$transaction(async (transaction) => {
    const first = await transaction.transcriptSegment.create({
      data: {
        sessionId,
        speakerId: "Facilitator",
        originalText: "First, return a 400 response before calling validateEmail when the email field is missing.",
        language: "en",
        startedAt,
        endedAt: new Date(startedAt.getTime() + 8_000),
        translations: {
          create: {
            targetLanguage: "zh",
            text: "首先，当 email 字段缺失时，请在调用 validateEmail 之前返回 400 响应。",
            provider: "demo-scenario",
            qualitySignal: "high",
          },
        },
      },
    });
    const second = await transaction.transcriptSegment.create({
      data: {
        sessionId,
        speakerId: "Learner A",
        originalText: "如果 email 是空的，会报 500 错误。",
        language: "zh",
        startedAt: new Date(startedAt.getTime() + 9_000),
        endedAt: new Date(startedAt.getTime() + 13_000),
        translations: {
          create: {
            targetLanguage: "en",
            text: "If the email is empty, it throws a 500 error.",
            provider: "demo-scenario",
            qualitySignal: "high",
          },
        },
      },
    });
    const third = await transaction.transcriptSegment.create({
      data: {
        sessionId,
        speakerId: "Learner B",
        originalText: "我们试着加了 if (!req.body.email) return res.status(400)，但还是报错。",
        language: "zh",
        startedAt: new Date(startedAt.getTime() + 14_000),
        endedAt: new Date(startedAt.getTime() + 21_000),
        translations: {
          create: {
            targetLanguage: "en",
            text: "We tried adding if (!req.body.email) return res.status(400), but it still errors.",
            provider: "demo-scenario",
            qualitySignal: "medium",
            preservedSpans: ["if (!req.body.email) return res.status(400)"],
          },
        },
      },
    });

    const activity = await transaction.insight.create({
      data: {
        sessionId,
        type: "ACTIVITY",
        summary: "Debugging validation for an empty email field.",
      },
    });
    const decision = await transaction.insight.create({
      data: {
        sessionId,
        type: "DECISION",
        summary: "Add an early 400 response before email validation.",
      },
    });
    const blocker = await transaction.insight.create({
      data: {
        sessionId,
        type: "BLOCKER",
        summary: "The group still sees a 500 error after adding the early return.",
      },
    });
    await transaction.insightEvidence.createMany({
      data: [
        { insightId: activity.id, transcriptSegmentId: second.id },
        { insightId: decision.id, transcriptSegmentId: first.id },
        { insightId: blocker.id, transcriptSegmentId: third.id },
      ],
    });
  });

  revalidatePath(`/sessions/${sessionId}/facilitator`);
  revalidatePath(`/sessions/${sessionId}/learn`);
}

export async function publishCaption(sessionId: string, formData: FormData) {
  if (!(await hasFacilitatorAccess(sessionId))) redirect("/setup");

  const captionText = formData.get("captionText");
  if (typeof captionText !== "string" || !captionText.trim() || captionText.trim().length > 3_000) {
    throw new Error("Enter a caption of up to 3,000 characters.");
  }

  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session || session.status !== SessionStatus.LIVE) {
    throw new Error("Start the session before publishing captions.");
  }

  const now = new Date();
  await persistTranslatedSegment(session, {
    speakerId: "Facilitator",
    originalText: captionText.trim(),
    language: session.sourceLanguage as SupportedLanguage,
    startedAt: now,
    endedAt: now,
  });

  revalidatePath(`/sessions/${sessionId}/facilitator`);
  revalidatePath(`/sessions/${sessionId}/learn`);
  await roomProvider.notifyCaptionsChanged(sessionId);
}

/**
 * Transcribes a recorded audio chunk via `speechToTextProvider` and publishes
 * it the same way `publishCaption` publishes typed text — Part 2 of
 * `docs/TRANSLATION_ARCHITECTURE.md`. No-ops (rather than throwing) when the
 * transcript comes back empty, since silence/noise chunks are expected in a
 * chunked-capture flow.
 */
export async function transcribeAndPublishCaption(sessionId: string, formData: FormData) {
  if (!(await hasFacilitatorAccess(sessionId))) redirect("/setup");

  if (!speechToTextProvider.isConfigured) {
    throw new Error("Speech-to-text is not configured: set STT_API_KEY.");
  }

  const audio = formData.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    throw new Error("An audio chunk is required.");
  }

  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session || session.status !== SessionStatus.LIVE) {
    throw new Error("Start the session before publishing captions.");
  }

  const sourceLanguage = session.sourceLanguage as SupportedLanguage;
  const segment = await speechToTextProvider.transcribeChunk({
    audio: new Uint8Array(await audio.arrayBuffer()),
    mimeType: audio.type || "audio/webm",
    expectedLanguage: sourceLanguage,
    speakerId: "Facilitator",
  });

  if (!segment.originalText) {
    return;
  }

  await persistTranslatedSegment(session, {
    speakerId: segment.speakerId,
    originalText: segment.originalText,
    language: segment.language,
    startedAt: segment.startedAt,
    endedAt: segment.endedAt,
  });

  revalidatePath(`/sessions/${sessionId}/facilitator`);
  revalidatePath(`/sessions/${sessionId}/learn`);
  await roomProvider.notifyCaptionsChanged(sessionId);
}
