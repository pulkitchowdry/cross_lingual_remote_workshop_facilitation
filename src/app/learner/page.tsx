import { mockFacilitatorReplies } from "@/lib/mock-data";

export default function LearnerPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Facilitator messages</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          What the remote facilitator has said, in your language and the original.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        {mockFacilitatorReplies.map((entry) => (
          <div
            key={entry.id}
            className="flex flex-col gap-1 rounded-lg border border-black/10 p-3 dark:border-white/10"
          >
            <span className="text-sm font-semibold">{entry.speaker}</span>
            <p className="text-sm">{entry.translation}</p>
            <p className="text-sm text-zinc-500 dark:text-zinc-400" lang="und">
              {entry.original}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
