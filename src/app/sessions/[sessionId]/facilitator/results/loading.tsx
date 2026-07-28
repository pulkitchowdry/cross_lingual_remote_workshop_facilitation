import { Card } from "@/components/ui/Card";

export default function ResultsLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading session results" role="status">
      <div>
        <div className="h-7 w-48 rounded-md bg-surface-raised" />
        <div className="mt-2 h-4 w-80 max-w-full rounded-md bg-surface-raised" />
      </div>
      <Card>
        <div className="flex flex-col gap-3">
          <div className="h-4 w-36 rounded-md bg-surface" />
          <div className="h-5 w-full max-w-md rounded-md bg-surface" />
          <div className="h-4 w-full rounded-md bg-surface" />
        </div>
      </Card>
      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <div className="flex flex-col gap-2">
            <div className="h-4 w-28 rounded-md bg-surface" />
            <div className="h-4 w-full rounded-md bg-surface" />
          </div>
        </Card>
        <Card>
          <div className="flex flex-col gap-2">
            <div className="h-4 w-28 rounded-md bg-surface" />
            <div className="h-4 w-full rounded-md bg-surface" />
          </div>
        </Card>
      </div>
    </div>
  );
}
