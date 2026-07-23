import type { TranscriptEntry } from "@/lib/types";
import { Card } from "@/components/ui/Card";
import { ConfidenceBadge } from "@/components/ui/ConfidenceBadge";

export function TranscriptEntryView({ entry }: { entry: TranscriptEntry }) {
  return (
    <Card
      title={entry.speaker}
      meta={<ConfidenceBadge confidence={entry.confidence} />}
    >
      <p className="text-muted-foreground" lang="und">
        {entry.original}
      </p>
      <p className="mt-1">
        {entry.translation}
        {entry.hasPreservedSpan && (
          <span className="ml-2 rounded bg-background px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
            code/jargon preserved
          </span>
        )}
      </p>
    </Card>
  );
}
