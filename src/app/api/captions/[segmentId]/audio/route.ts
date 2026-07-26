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

/**
 * A transcript segment's text/translation never changes once written, so its
 * synthesized audio is safe to cache indefinitely per (segment, language) — this
 * process's own memory is a valid place to do that (this app runs as a single
 * persistent Node process, not per-request serverless instances; see `server.ts`).
 * `Cache-Control: private, max-age=3600` below only advises the *browser's* own
 * cache and does nothing to stop a script bypassing it (a raw loop of GETs for the
 * same segment+language), which — without this — re-synthesized via the paid
 * ElevenLabs API on every single request. `MAX_CACHE_ENTRIES` bounds memory for a
 * long-running process; oldest-inserted entries are evicted first (a `Map`'s
 * natural iteration order), not a true LRU, which is a fine tradeoff for how
 * infrequently this needs to evict anything in practice.
 */
const MAX_CACHE_ENTRIES = 500;
const audioCache = new Map<string, { audio: Uint8Array; mimeType: string }>();

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

  const cacheKey = `${segmentId}:${language}`;
  const cached = audioCache.get(cacheKey);
  if (cached) {
    return new Response(Buffer.from(cached.audio), {
      headers: { "Content-Type": cached.mimeType, "Cache-Control": "private, max-age=3600" },
    });
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
      // Fail closed (no cloud fallback) if `session` is unexpectedly gone —
      // e.g. the retention-cleanup cron deleted it between this route's two
      // queries — rather than defaulting a privacy gate to permissive.
      allowCloudFallback: session !== null && session.translationMode !== "LOCAL_ONLY",
    });
  } catch (error) {
    console.error("textToSpeechProvider.synthesize failed", error);
    return Response.json({ error: "Speech synthesis failed." }, { status: 502 });
  }
  if (!speech) {
    return Response.json({ error: "Speech synthesis returned no audio." }, { status: 502 });
  }

  const audioBuffer = Buffer.from(speech.audio);
  if (audioCache.size >= MAX_CACHE_ENTRIES && !audioCache.has(cacheKey)) {
    const oldestKey = audioCache.keys().next().value;
    if (oldestKey !== undefined) audioCache.delete(oldestKey);
  }
  audioCache.set(cacheKey, { audio: audioBuffer, mimeType: speech.mimeType });

  return new Response(audioBuffer, {
    headers: { "Content-Type": speech.mimeType, "Cache-Control": "private, max-age=3600" },
  });
}
