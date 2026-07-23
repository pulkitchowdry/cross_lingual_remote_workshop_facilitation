import type { SessionSummary } from "@/lib/types";

export function SummaryCard({ summary }: { summary: SessionSummary }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-black/10 p-4 dark:border-white/10">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{summary.activity}</h3>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{summary.timestamp}</span>
      </div>
      {summary.decisions.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
            Decisions
          </p>
          <ul className="list-disc pl-5 text-sm">
            {summary.decisions.map((decision) => (
              <li key={decision}>{decision}</li>
            ))}
          </ul>
        </div>
      )}
      {summary.blockers.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
            Blockers
          </p>
          <ul className="list-disc pl-5 text-sm">
            {summary.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
