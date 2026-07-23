import { FacilitatorMessage } from "@/components/FacilitatorMessage";
import { LiveCaptionTicker } from "@/components/LiveCaptionTicker";
import { QuestionBox } from "@/components/QuestionBox";
import { mockFacilitatorReplies, mockLiveCaptionFeed } from "@/lib/mock-data";

export default function LearnerPage() {
  return (
    <div className="flex flex-col gap-6">
      <LiveCaptionTicker feed={mockLiveCaptionFeed} label="Live captions" />
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
