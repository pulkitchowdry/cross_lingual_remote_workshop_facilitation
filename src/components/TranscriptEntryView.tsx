import type { TranscriptEntry } from "@/lib/types";

const confidenceStyles: Record<TranscriptEntry["confidence"], string> = {
  high: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  low: "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200",
};

export function TranscriptEntryView({ entry }: { entry: TranscriptEntry }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-black/10 p-3 dark:border-white/10">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{entry.speaker}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${confidenceStyles[entry.confidence]}`}
        >
          {entry.confidence} confidence
        </span>
      </div>
      <p className="text-sm text-zinc-500 dark:text-zinc-400" lang="und">
        {entry.original}
      </p>
      <p className="text-sm">
        {entry.translation}
        {entry.hasPreservedSpan && (
          <span className="ml-2 rounded bg-zinc-200 px-1.5 py-0.5 font-mono text-xs dark:bg-zinc-800">
            code/jargon preserved
          </span>
        )}
      </p>
    </div>
  );
}
