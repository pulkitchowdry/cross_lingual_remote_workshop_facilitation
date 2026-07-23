import { Button } from "@/components/ui/Button";
import { createSession } from "@/app/setup/actions";
import { SUPPORTED_LANGUAGES } from "@/lib/session-contracts";

export function SetupForm() {
  return (
    <form className="flex max-w-xl flex-col gap-4" action={createSession}>
      <label className="flex flex-col gap-2 text-sm font-medium">
        Your name
        <input
          className="rounded-lg border border-border-strong bg-surface-raised p-3 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          name="facilitatorName"
          required
          maxLength={80}
          placeholder="e.g. Priya, workshop facilitator"
        />
      </label>
      <label className="flex flex-col gap-2 text-sm font-medium">
        Session title
        <input
          className="rounded-lg border border-border-strong bg-surface-raised p-3 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          name="title"
          required
          maxLength={120}
          placeholder="e.g. REST endpoint workshop"
        />
      </label>
      <label className="flex flex-col gap-2 text-sm font-medium">
        Workshop goal
        <textarea
          className="rounded-lg border border-border-strong bg-surface-raised p-3 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          rows={4}
          required
          name="goal"
          maxLength={1000}
          placeholder="e.g. Implement a working REST endpoint for user signup, including input validation."
        />
      </label>
      <label className="flex flex-col gap-2 text-sm font-medium">
        Facilitator&apos;s language
        <select
          className="rounded-lg border border-border-strong bg-surface-raised p-3 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          name="sourceLanguage"
          defaultValue="en"
        >
          {SUPPORTED_LANGUAGES.map((language) => (
            <option key={language.value} value={language.value}>
              {language.label}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Learner languages</legend>
        <p className="text-sm text-muted-foreground">
          Learners choose one of these when they join. Start with the languages you can support.
        </p>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {SUPPORTED_LANGUAGES.map((language) => (
            <label key={language.value} className="flex items-center gap-2 text-sm">
              <input name="learnerLanguages" type="checkbox" value={language.value} defaultChecked />
              {language.label}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-2 text-sm font-medium">
        Transcript retention
        <select
          className="rounded-lg border border-border-strong bg-surface-raised p-3 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          name="retentionDays"
          defaultValue="7"
        >
          <option value="1">Delete after 1 day</option>
          <option value="7">Delete after 7 days</option>
          <option value="30">Delete after 30 days</option>
        </select>
      </label>
      <p className="text-sm text-muted-foreground">
        You&apos;ll receive a private learner link after creating the session. Live audio is not recorded by default.
      </p>
      <Button type="submit">Create session</Button>
    </form>
  );
}
