import type { Confidence } from "@/lib/types";

const CONFIDENCE_STYLES: Record<Confidence, string> = {
  high: "bg-[--confidence-high-bg] text-[--confidence-high-fg]",
  medium: "bg-[--confidence-medium-bg] text-[--confidence-medium-fg]",
  low: "bg-[--confidence-low-bg] text-[--confidence-low-fg]",
};

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${CONFIDENCE_STYLES[confidence]}`}
    >
      {confidence} confidence
    </span>
  );
}
