import { Card } from "@/components/ui/Card";
import type { SessionSummary } from "@/lib/types";

function DotList({ items, color }: { items: string[]; color: string }) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2 text-sm">
          <span
            className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
            aria-hidden="true"
          />
          {item}
        </li>
      ))}
    </ul>
  );
}

export function SummaryCard({ summary }: { summary: SessionSummary }) {
  return (
    <Card title={summary.activity} meta={<span className="font-data">{summary.timestamp}</span>}>
      <div className="flex flex-col gap-3">
        {summary.decisions.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="font-data text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground">
              Decisions
            </p>
            <DotList items={summary.decisions} color="var(--tick-high)" />
          </div>
        )}
        {summary.blockers.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="font-data text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground">
              Blockers
            </p>
            <DotList items={summary.blockers} color="var(--tick-low)" />
          </div>
        )}
      </div>
    </Card>
  );
}
