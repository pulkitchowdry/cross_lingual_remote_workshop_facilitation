import type { SessionSummary } from "@/lib/types";
import { Card } from "@/components/ui/Card";

export function SummaryCard({ summary }: { summary: SessionSummary }) {
  return (
    <Card title={summary.activity} meta={summary.timestamp}>
      <div className="flex flex-col gap-3">
        {summary.decisions.length > 0 && (
          <div className="border-l-2 border-border-strong pl-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Decisions
            </p>
            <ul className="list-disc pl-4">
              {summary.decisions.map((decision) => (
                <li key={decision}>{decision}</li>
              ))}
            </ul>
          </div>
        )}
        {summary.blockers.length > 0 && (
          <div className="border-l-2 border-[--confidence-low-fg] pl-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Blockers
            </p>
            <ul className="list-disc pl-4">
              {summary.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}
