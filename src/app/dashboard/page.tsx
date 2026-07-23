import { DashboardPanel } from "@/components/DashboardPanel";
import { ReplyBox } from "@/components/ReplyBox";
import { TranscriptEntryView } from "@/components/TranscriptEntryView";
import { ConfidenceBadge } from "@/components/ui/ConfidenceBadge";
import {
  mockBlockers,
  mockCurrentActivity,
  mockDecisions,
  mockGoal,
  mockTranscript,
} from "@/lib/mock-data";

function QuoteLine({ quoteId }: { quoteId: string }) {
  const entry = mockTranscript.find((t) => t.id === quoteId);
  if (!entry) return null;
  return (
    <div className="mt-1 flex items-start gap-2 text-xs text-muted-foreground">
      <ConfidenceBadge confidence={entry.confidence} />
      <span className="italic">&ldquo;{entry.translation}&rdquo;</span>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Facilitator dashboard</h1>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <DashboardPanel title="Goal">{mockGoal}</DashboardPanel>
        <DashboardPanel title="Current activity">{mockCurrentActivity}</DashboardPanel>
        <DashboardPanel title="Decisions">
          <ul className="list-disc pl-5">
            {mockDecisions.map((decision) => (
              <li key={decision.id}>
                {decision.summary}
                <QuoteLine quoteId={decision.quoteId} />
              </li>
            ))}
          </ul>
        </DashboardPanel>
        <DashboardPanel title="Blockers">
          <ul className="list-disc pl-5">
            {mockBlockers.map((blocker) => (
              <li key={blocker.id}>
                {blocker.summary}
                <QuoteLine quoteId={blocker.quoteId} />
              </li>
            ))}
          </ul>
        </DashboardPanel>
      </div>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Transcript</h2>
        <div className="flex flex-col gap-3">
          {mockTranscript.map((entry) => (
            <TranscriptEntryView key={entry.id} entry={entry} />
          ))}
        </div>
      </section>
      <ReplyBox />
    </div>
  );
}
