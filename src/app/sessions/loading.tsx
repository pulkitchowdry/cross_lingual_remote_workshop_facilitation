import { Card } from "@/components/ui/Card";

export default function SessionsOverviewLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div className="h-6 w-40 rounded-md bg-surface-raised" />
      <div className="flex flex-col gap-2">
        <div className="h-8 w-64 rounded-md bg-surface-raised" />
        <div className="h-4 w-full max-w-lg rounded-md bg-surface-raised" />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <div className="flex flex-col gap-3">
            <div className="h-4 w-32 rounded-md bg-surface" />
            <div className="h-5 w-48 rounded-md bg-surface" />
            <div className="h-4 w-full rounded-md bg-surface" />
          </div>
        </Card>
        <Card>
          <div className="flex flex-col gap-3">
            <div className="h-4 w-32 rounded-md bg-surface" />
            <div className="h-5 w-48 rounded-md bg-surface" />
            <div className="h-4 w-full rounded-md bg-surface" />
          </div>
        </Card>
      </div>
    </div>
  );
}
