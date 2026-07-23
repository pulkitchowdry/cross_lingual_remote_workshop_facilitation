import { SetupForm } from "@/components/SetupForm";

export default function SetupPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Session setup</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Set the workshop goal once, before the session starts. The dashboard uses this to
          judge whether the group&apos;s discussion is on track.
        </p>
      </div>
      <SetupForm />
    </div>
  );
}
