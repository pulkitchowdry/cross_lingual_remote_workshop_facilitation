import { DashboardPanel } from "@/components/DashboardPanel";
import { ReplyBox } from "@/components/ReplyBox";
import { TranscriptEntryView } from "@/components/TranscriptEntryView";
import {
  mockBlockers,
  mockCurrentActivity,
  mockDecisions,
  mockGoal,
  mockLearnerQuestions,
  mockTranscript,
} from "@/lib/mock-data";
import type { TranscriptEntry } from "@/lib/types";

const confidenceStyles: Record<TranscriptEntry["confidence"], string> = {
  high: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  low: "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200",
};

function QuoteLine({ quoteId }: { quoteId: string }) {
  const entry = mockTranscript.find((t) => t.id === quoteId);
  if (!entry) return null;
  return (
    <div className="mt-1 flex items-start gap-2 text-xs text-zinc-500 dark:text-zinc-400">
      <span
        className={`shrink-0 rounded-full px-2 py-0.5 font-medium ${confidenceStyles[entry.confidence]}`}
      >
        {entry.confidence} confidence
      </span>
      <span className="italic">&ldquo;{entry.translation}&rdquo;</span>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Facilitator dashboard</h1>
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
      {mockLearnerQuestions.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Learner questions</h2>
          <div className="flex flex-col gap-3">
            {mockLearnerQuestions.map((entry) => (
              <TranscriptEntryView key={entry.id} entry={entry} />
            ))}
          </div>
        </section>
      )}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Transcript</h2>
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
