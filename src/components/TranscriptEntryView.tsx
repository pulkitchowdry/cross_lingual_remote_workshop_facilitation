import { ConfidenceTick } from "@/components/ui/ConfidenceTick";
import { getSpeakerColor } from "@/lib/speaker-color";
import type { TranscriptEntry } from "@/lib/types";

export function TranscriptEntryView({ entry }: { entry: TranscriptEntry }) {
  const speakerColor = getSpeakerColor(entry.speaker);

  return (
    <div
      className="flex flex-col gap-1.5 rounded-lg border border-border-subtle bg-surface-raised p-3"
      style={{ borderLeft: `3px solid ${speakerColor}` }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-heading text-sm font-semibold" style={{ color: speakerColor }}>
          {entry.speaker}
        </span>
        <ConfidenceTick confidence={entry.confidence} />
      </div>
      <p className="text-xs italic text-muted-foreground" lang="und">
        {entry.original}
      </p>
      <p className="text-base leading-snug text-foreground">
        {entry.translation}
        {entry.hasPreservedSpan && (
          <span className="font-data ml-2 rounded border border-border-strong px-1.5 py-0.5 text-[0.6875rem] text-muted-foreground">
            {"</>"} preserved
          </span>
        )}
      </p>
    </div>
  );
}
