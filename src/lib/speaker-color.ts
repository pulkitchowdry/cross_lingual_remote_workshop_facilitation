const SPEAKER_COLORS = [
  "var(--speaker-1)",
  "var(--speaker-2)",
  "var(--speaker-3)",
  "var(--speaker-4)",
];

/**
 * Deterministic per-speaker identity color (BBC subtitle convention: same
 * speaker keeps the same color all session). "Facilitator" always gets the
 * accent color instead of a palette slot, so the role reads as distinct from
 * learners at a glance.
 */
export function getSpeakerColor(speaker: string): string {
  if (speaker.toLowerCase() === "facilitator") {
    return "var(--accent)";
  }

  let hash = 0;
  for (let i = 0; i < speaker.length; i++) {
    hash = (hash * 31 + speaker.charCodeAt(i)) | 0;
  }

  return SPEAKER_COLORS[Math.abs(hash) % SPEAKER_COLORS.length];
}
