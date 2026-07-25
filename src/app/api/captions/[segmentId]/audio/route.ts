import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { hasFacilitatorAccess, learnerParticipantId } from "@/lib/session-access";
import { textToSpeechProvider } from "@/lib/providers/text-to-speech";
import type { SupportedLanguage } from "@/lib/session-contracts";

/**
 * On-demand translated-audio synthesis for one transcript segment — Part 3 of
 * `docs/TRANSLATION_ARCHITECTURE.md`, opt-in voice translation. Per-listener
 * delivery (synthesize on request, stream the bytes back), not the doc's
 * fuller per-language "interpreter participant" design — that needs a
 * persistent LiveKit bot participant per language, which is the same
 * always-on-process tradeoff as `src/lib/caption-agent.ts`'s track-subscription worker and is
 * left as follow-up. This route stays serverless-compatible: no LiveKit
 * publish involved, just synthesize-and-return.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ segmentId: string }> }) {
  if (!textToSpeechProvider.isConfigured) {
    return Response.json({ error: "Text-to-speech is not configured: set TTS_API_KEY." }, { status: 503 });
  }

  const { segmentId } = await params;
  const language = request.nextUrl.searchParams.get("lang");
  if (!language) {
    return Response.json({ error: "lang is required." }, { status: 400 });
  }

  const segment = await prisma.transcriptSegment.findUnique({
    where: { id: segmentId },
    include: { translations: true },
  });
  if (!segment) return Response.json({ error: "Segment not found." }, { status: 404 });

  const isAuthorized =
    (await hasFacilitatorAccess(segment.sessionId)) || Boolean(await learnerParticipantId(segment.sessionId));
  if (!isAuthorized) {
    return Response.json({ error: "Not authorized for this session." }, { status: 403 });
  }

  const text =
    segment.language === language
      ? segment.originalText
      : segment.translations.find((translation) => translation.targetLanguage === language)?.text;
  if (!text) {
    return Response.json({ error: "No text available in the requested language." }, { status: 404 });
  }

  const session = await prisma.session.findUnique({
    where: { id: segment.sessionId },
    select: { translationMode: true },
  });

  let speech;
  try {
    speech = await textToSpeechProvider.synthesize(text, language as SupportedLanguage, {
      allowCloudFallback: session?.translationMode !== "LOCAL_ONLY",
    });
  } catch {
    return Response.json({ error: "Speech synthesis failed." }, { status: 502 });
  }
  if (!speech) {
    return Response.json({ error: "Speech synthesis returned no audio." }, { status: 502 });
  }

  return new Response(Buffer.from(speech.audio), {
    headers: { "Content-Type": speech.mimeType, "Cache-Control": "private, max-age=3600" },
  });
}
