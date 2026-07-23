import { mockFacilitatorReplies } from "@/lib/mock-data";
import { Card } from "@/components/ui/Card";

export default function LearnerPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Facilitator messages</h1>
        <p className="text-sm text-muted-foreground">
          What the remote facilitator has said, in your language and the original.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        {mockFacilitatorReplies.map((entry) => (
          <Card key={entry.id} title={entry.speaker}>
            <p className="font-medium">{entry.translation}</p>
            <p className="mt-1 text-muted-foreground" lang="und">
              {entry.original}
            </p>
          </Card>
        ))}
      </div>
    </div>
  );
}
