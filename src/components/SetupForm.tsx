import { Button } from "@/components/ui/Button";
import { createSession } from "@/app/setup/actions";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/lib/session-contracts";
import { getDictionary } from "@/lib/i18n";

export function SetupForm({ lang }: { lang: SupportedLanguage }) {
  const dict = getDictionary(lang);
  const languageNames = dict.languageNames;

  return (
    <form className="flex max-w-xl flex-col gap-4" action={createSession}>
      <label className="flex flex-col gap-2 text-sm font-medium">
        {dict.setup.yourName}
        <input
          className="rounded-lg border border-border-strong bg-surface-raised p-3 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          name="facilitatorName"
          required
          maxLength={80}
          placeholder={dict.setup.yourNamePlaceholder}
        />
      </label>
      <label className="flex flex-col gap-2 text-sm font-medium">
        {dict.setup.sessionTitle}
        <input
          className="rounded-lg border border-border-strong bg-surface-raised p-3 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          name="title"
          required
          maxLength={120}
          placeholder={dict.setup.sessionTitlePlaceholder}
        />
      </label>
      <label className="flex flex-col gap-2 text-sm font-medium">
        {dict.setup.workshopGoal}
        <textarea
          className="rounded-lg border border-border-strong bg-surface-raised p-3 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          rows={4}
          required
          name="goal"
          maxLength={1000}
          placeholder={dict.setup.workshopGoalPlaceholder}
        />
      </label>
      <label className="flex flex-col gap-2 text-sm font-medium">
        {dict.setup.facilitatorLanguage}
        <select
          className="rounded-lg border border-border-strong bg-surface-raised p-3 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          name="sourceLanguage"
          defaultValue={lang}
        >
          {SUPPORTED_LANGUAGES.map((language) => (
            <option key={language.value} value={language.value}>
              {languageNames[language.value]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-2 text-sm font-medium">
        {dict.setup.retention}
        <select
          className="rounded-lg border border-border-strong bg-surface-raised p-3 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          name="retentionDays"
          defaultValue="7"
        >
          <option value="1">{dict.setup.retentionDay}</option>
          <option value="7">{dict.setup.retentionWeek}</option>
          <option value="30">{dict.setup.retentionMonth}</option>
        </select>
      </label>
      <p className="text-sm text-muted-foreground">{dict.setup.privacyNote}</p>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input name="strictPrivacy" type="checkbox" />
        {dict.setup.strictPrivacyLabel}
      </label>
      <p className="text-sm text-muted-foreground">{dict.setup.strictPrivacyHint}</p>
      <Button type="submit">{dict.setup.submit}</Button>
    </form>
  );
}
