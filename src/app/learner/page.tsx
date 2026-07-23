import { FacilitatorMessage } from "@/components/FacilitatorMessage";
import { LiveCaptionTicker } from "@/components/LiveCaptionTicker";
import { PollWidget } from "@/components/PollWidget";
import { QuestionBox } from "@/components/QuestionBox";
import { QuietParticipantNudge } from "@/components/QuietParticipantNudge";
import { RaiseHandSuggestion } from "@/components/RaiseHandSuggestion";
import {
  mockCurrentLearnerId,
  mockFacilitatorReplies,
  mockLiveCaptionFeed,
  mockParticipation,
  mockPoll,
} from "@/lib/mock-data";

export default function LearnerPage() {
  const currentLearner = mockParticipation.learners.find(
    (learner) => learner.id === mockCurrentLearnerId
  );

  return (
    <div className="flex flex-col gap-6">
      <LiveCaptionTicker feed={mockLiveCaptionFeed} label="Live captions" />
      {currentLearner && <QuietParticipantNudge learner={currentLearner} />}
      {currentLearner && <RaiseHandSuggestion learner={currentLearner} />}
      <div>
        <h1 className="font-heading text-2xl font-semibold">Facilitator messages</h1>
        <p className="text-sm text-muted-foreground">
          What the remote facilitator has said, in your language and the original.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        {mockFacilitatorReplies.map((entry) => (
          <FacilitatorMessage key={entry.id} entry={entry} />
        ))}
      </div>
      <section className="flex flex-col gap-3 border-t border-border-subtle pt-6">
        <div>
          <h2 className="font-heading text-lg font-semibold">Comprehension poll</h2>
          <p className="text-sm text-muted-foreground">
            The facilitator wants a quick check on how the session is landing.
          </p>
        </div>
        <PollWidget poll={mockPoll} />
      </section>
      <section className="flex flex-col gap-3 border-t border-border-subtle pt-6">
        <div>
          <h2 className="font-heading text-lg font-semibold">Have a question?</h2>
          <p className="text-sm text-muted-foreground">
            Ask in your own language — the facilitator will see it translated.
          </p>
        </div>
        <QuestionBox />
      </section>
    </div>
  );
}
