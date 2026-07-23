import { LiveCaptionTicker } from "@/components/LiveCaptionTicker";
import { ParticipationDashboard } from "@/components/ParticipationDashboard";
import { PollResults } from "@/components/PollResults";
import { ReplyBox } from "@/components/ReplyBox";
import { TranscriptEntryView } from "@/components/TranscriptEntryView";
import { Card } from "@/components/ui/Card";
import { ConfidenceTick } from "@/components/ui/ConfidenceTick";
import { getSpeakerColor } from "@/lib/speaker-color";
import {
  mockBlockers,
  mockCurrentActivity,
  mockDecisions,
  mockGoal,
  mockLearnerQuestions,
  mockLiveCaptionFeed,
  mockParticipation,
  mockPoll,
  mockTranscript,
} from "@/lib/mock-data";

function QuoteLine({ quoteId }: { quoteId: string }) {
  const entry = mockTranscript.find((t) => t.id === quoteId);
  if (!entry) return null;
  const speakerColor = getSpeakerColor(entry.speaker);

  return (
    <div
      className="mt-1.5 flex flex-col gap-1 rounded-md border border-border-subtle bg-background px-2.5 py-2"
      style={{ borderLeft: `2px solid ${speakerColor}` }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-data text-xs font-medium" style={{ color: speakerColor }}>
          {entry.speaker}
        </span>
        <ConfidenceTick confidence={entry.confidence} />
      </div>
      <span className="text-xs italic text-muted-foreground">
        &ldquo;{entry.translation}&rdquo;
      </span>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <LiveCaptionTicker feed={mockLiveCaptionFeed} label="Live captions" />
      <h1 className="font-heading text-2xl font-semibold">Facilitator dashboard</h1>
      <ParticipationDashboard snapshot={mockParticipation} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card eyebrow="Goal">{mockGoal}</Card>
        <Card eyebrow="Current activity">{mockCurrentActivity}</Card>
        <Card eyebrow="Decisions">
          <ul className="flex flex-col gap-3">
            {mockDecisions.map((decision) => (
              <li key={decision.id}>
                {decision.summary}
                <QuoteLine quoteId={decision.quoteId} />
              </li>
            ))}
          </ul>
        </Card>
        <Card eyebrow="Blockers">
          <ul className="flex flex-col gap-3">
            {mockBlockers.map((blocker) => (
              <li key={blocker.id}>
                {blocker.summary}
                <QuoteLine quoteId={blocker.quoteId} />
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-semibold">Comprehension poll</h2>
        <Card>
          <PollResults poll={mockPoll} />
        </Card>
      </section>
      {mockLearnerQuestions.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-heading text-lg font-semibold">Learner questions</h2>
          <div className="flex flex-col gap-3">
            {mockLearnerQuestions.map((entry) => (
              <TranscriptEntryView key={entry.id} entry={entry} />
            ))}
          </div>
        </section>
      )}
      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-semibold">Transcript</h2>
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
