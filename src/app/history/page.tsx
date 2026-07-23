import { SummaryCard } from "@/components/SummaryCard";
import { mockHistory } from "@/lib/mock-data";

export default function HistoryPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Session history</h1>
        <p className="text-sm text-muted-foreground">
          Catch-up summaries for a facilitator joining mid-session or reviewing after.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        {mockHistory.map((summary) => (
          <SummaryCard key={summary.id} summary={summary} />
        ))}
      </div>
    </div>
  );
}
