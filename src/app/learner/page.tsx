import { QuestionBox } from "@/components/QuestionBox";
import { ConfidenceTick } from "@/components/ui/ConfidenceTick";
import { getSpeakerColor } from "@/lib/speaker-color";
import { mockFacilitatorReplies } from "@/lib/mock-data";

export default function LearnerPage() {
  const facilitatorColor = getSpeakerColor("Facilitator");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Facilitator messages</h1>
        <p className="text-sm text-muted-foreground">
          What the remote facilitator has said, in your language and the original.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        {mockFacilitatorReplies.map((entry) => (
          <div
            key={entry.id}
            className="flex flex-col gap-1.5 rounded-lg border border-border-subtle bg-surface-raised p-3"
            style={{ borderLeft: `3px solid ${facilitatorColor}` }}
          >
            <div className="flex items-center justify-between gap-2">
              <span
                className="font-heading text-sm font-semibold"
                style={{ color: facilitatorColor }}
              >
                {entry.speaker}
              </span>
              <ConfidenceTick confidence={entry.confidence} />
            </div>
            <p className="text-base leading-snug text-foreground">{entry.translation}</p>
            <p className="text-xs italic text-muted-foreground" lang="und">
              {entry.original}
            </p>
          </div>
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
