import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { hasFacilitatorAccess, learnerParticipantId } from "@/lib/session-access";
import { textToSpeechProvider } from "@/lib/providers/text-to-speech";
import { isSessionRetentionExpired } from "@/lib/session-retention";
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
 *
 * The cache stores the in-flight `Promise`, not just its resolved value: two
 * requests for the same (segment, language) arriving close together (two
 * browser tabs, or a re-render re-triggering a fetch before the first
 * resolves) both need to land on the SAME synthesis call rather than each
 * kicking off (and paying for) their own. If that promise rejects, the entry
 * is deleted so a transient synthesis failure doesn't permanently poison the
 * cache for that key.
 */
const MAX_CACHE_ENTRIES = 500;
const audioCache = new Map<string, Promise<{ audio: Uint8Array; mimeType: string }>>();

/** Distinguishes "provider returned no audio" from a thrown/rejected synthesize() call. */
class NoAudioError extends Error {}

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

  const session = await prisma.session.findUnique({
    where: { id: segment.sessionId },
    select: { status: true, createdAt: true, startedAt: true, endedAt: true, retentionDays: true, translationMode: true },
  });
  // Unlike every other route/page serving session content, this one had no retention
  // check at all — an authorized facilitator/learner could keep re-synthesizing (and
  // this process's own in-memory cache kept serving) a segment's audio indefinitely
  // past the session's own "delete after N days" privacy choice, as long as the
  // cleanup cron just hadn't physically deleted the row yet.
  if (!session || isSessionRetentionExpired(session)) {
    // This segment's own cached audio (across whichever languages have been requested
    // for it) must not keep outliving the session's configured retention deadline just
    // because it's sitting in this process's in-memory `audioCache` — a full proactive
    // sweep (evicting every segment's cache entries the moment a session's retention
    // cron actually runs) is a larger cross-file change than fits here. This narrower,
    // request-triggered eviction at least makes the cache self-heal for an expired
    // session's segments as they're naturally requested again, one segmentId at a time.
    for (const key of audioCache.keys()) {
      if (key.startsWith(`${segmentId}:`)) audioCache.delete(key);
    }
    return Response.json({ error: "This session's data is no longer available." }, { status: 404 });
  }

  const cacheKey = `${segmentId}:${language}`;
  let synthesizing = audioCache.get(cacheKey);

  if (!synthesizing) {
    const text =
      segment.language === language
        ? segment.originalText
        : segment.translations.find((translation) => translation.targetLanguage === language)?.text;
    if (!text) {
      return Response.json({ error: "No text available in the requested language." }, { status: 404 });
    }

    // Set the in-flight promise into the cache *before* awaiting anything, so a
    // concurrent request for the same key (checked above) lands on this same
    // promise instead of racing its own synthesize() call — see the module doc
    // comment above.
    synthesizing = textToSpeechProvider
      .synthesize(text, language as SupportedLanguage, {
        allowCloudFallback: session.translationMode !== "LOCAL_ONLY",
      })
      .then((speech) => {
        if (!speech) throw new NoAudioError();
        return { audio: Buffer.from(speech.audio), mimeType: speech.mimeType };
      });

    if (audioCache.size >= MAX_CACHE_ENTRIES && !audioCache.has(cacheKey)) {
      const oldestKey = audioCache.keys().next().value;
      if (oldestKey !== undefined) audioCache.delete(oldestKey);
    }
    audioCache.set(cacheKey, synthesizing);
    // A failed synthesis must not permanently poison the cache for this key —
    // drop the entry so the next request retries instead of re-awaiting (and
    // re-throwing) the same rejected promise forever.
    synthesizing.catch(() => audioCache.delete(cacheKey));
  }

  let result;
  try {
    result = await synthesizing;
  } catch (error) {
    if (error instanceof NoAudioError) {
      return Response.json({ error: "Speech synthesis returned no audio." }, { status: 502 });
    }
    console.error("textToSpeechProvider.synthesize failed", error);
    return Response.json({ error: "Speech synthesis failed." }, { status: 502 });
  }

  return new Response(Buffer.from(result.audio), {
    headers: { "Content-Type": result.mimeType, "Cache-Control": "private, max-age=3600" },
  });
}
