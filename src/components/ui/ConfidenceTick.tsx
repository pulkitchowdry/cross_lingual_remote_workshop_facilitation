import type { Confidence } from "@/lib/types";

const TICK_COLOR: Record<Confidence, string> = {
  high: "var(--tick-high)",
  medium: "var(--tick-medium)",
  low: "var(--tick-low)",
};

const FILLED_BARS: Record<Confidence, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const BAR_HEIGHTS = [5, 8, 11];

/**
 * Confidence shown as a signal-strength glyph (fill count) plus a mono label,
 * not a solid colored pill — so the signal survives grayscale/colorblind viewing
 * instead of relying on hue as the only channel.
 */
export function ConfidenceTick({ confidence }: { confidence: Confidence }) {
  const color = TICK_COLOR[confidence];
  const filled = FILLED_BARS[confidence];

  return (
    <span className="inline-flex shrink-0 items-center gap-1.5" title={`${confidence} confidence`}>
      <span className="flex items-end gap-0.5" aria-hidden="true">
        {BAR_HEIGHTS.map((height, index) => (
          <span
            key={height}
            className="w-1 rounded-sm"
            style={{
              height: `${height}px`,
              backgroundColor: index < filled ? color : "var(--border-strong)",
            }}
          />
        ))}
      </span>
      <span
        className="font-data text-[0.6875rem] font-medium uppercase tracking-wider"
        style={{ color }}
      >
        {confidence} confidence
      </span>
    </span>
  );
}
