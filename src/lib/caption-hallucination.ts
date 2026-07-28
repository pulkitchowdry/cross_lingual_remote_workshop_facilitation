/**
 * Every STT tier this app can route through — Deepgram (the streaming path
 * used by both src/lib/captions-socket.ts's browser-mic fallback and
 * src/lib/caption-agent.ts's LiveKit worker) and local-inference's Whisper
 * tier (local-inference/app/models/whisper.py) — hallucinates the same
 * handful of stock filler phrases on silence or background noise, "You" and
 * "Thank you" chief among them (see openai/whisper#679). Deepgram in
 * particular tends to re-emit "You" on every ~400ms endpointing window while
 * the mic picks up nothing but room tone, flooding the transcript.
 *
 * Mirrors local-inference's `HALLUCINATED_PHRASES`/`_is_hallucinated` so both
 * the local-inference and Deepgram tiers get the same defense — PR #182 only
 * added this filter to the Whisper tier, which this app's live-caption paths
 * don't actually use unless `LOCAL_INFERENCE_URL` is configured.
 */
const HALLUCINATED_PHRASES = new Set([
  "you",
  "thank you",
  "thanks for watching",
  "thank you for watching",
  "please subscribe",
  "bye",
  "bye bye",
]);

/**
 * True only when the *entire* (not substring) normalized text matches a known
 * hallucinated filler phrase — a real utterance that merely contains "you"
 * mid-sentence ("I think you understand") is left untouched.
 */
export function isHallucinatedCaption(text: string): boolean {
  const normalized = text
    .replace(/[^\w\s]/g, "")
    .trim()
    .toLowerCase();
  return HALLUCINATED_PHRASES.has(normalized);
}
