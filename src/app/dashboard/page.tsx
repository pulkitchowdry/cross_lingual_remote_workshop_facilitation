import { DashboardPanel } from "@/components/DashboardPanel";
import { ReplyBox } from "@/components/ReplyBox";
import { TranscriptEntryView } from "@/components/TranscriptEntryView";
import {
  mockBlockers,
  mockCurrentActivity,
  mockDecisions,
  mockGoal,
  mockTranscript,
} from "@/lib/mock-data";

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
              <li key={decision.id}>{decision.summary}</li>
            ))}
          </ul>
        </DashboardPanel>
        <DashboardPanel title="Blockers">
          <ul className="list-disc pl-5">
            {mockBlockers.map((blocker) => (
              <li key={blocker.id}>{blocker.summary}</li>
            ))}
          </ul>
        </DashboardPanel>
      </div>
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
