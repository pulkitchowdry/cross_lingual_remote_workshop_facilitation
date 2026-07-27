import { Card } from "@/components/ui/Card";

export default function ResultsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="h-7 w-48 rounded-md bg-surface-raised" />
        <div className="mt-2 h-4 w-80 max-w-full rounded-md bg-surface-raised" />
      </div>
      <Card>
        <p className="text-muted-foreground">Loading session results...</p>
      </Card>
    </div>
  );
}
