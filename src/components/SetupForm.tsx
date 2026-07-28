"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";
import { createSession } from "@/app/setup/actions";
import type { SupportedLanguage } from "@/lib/session-contracts";
import { getDictionary } from "@/lib/i18n";
import { RequiredFieldMessages } from "@/components/RequiredFieldMessages";

/**
 * createSession awaits a per-language translateText fan-out (Claude/local-inference)
 * before it ever touches the DB, so the round-trip is slow enough for a double-click
 * to fire it twice — two separate Session + facilitator User rows for one intended
 * click, each paid for via real translation-API calls. Disabling on pending mirrors
 * JoinSubmitButton/StartSessionButton/ChatSendButton's own fix for the identical
 * class of bug. Must be its own component — `useFormStatus` only sees the nearest
 * ancestor `<form>`, so it can't be read by the component that renders that form.
 */
function CreateSessionButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

export function SetupForm({ lang }: { lang: SupportedLanguage }) {
  const dict = getDictionary(lang);

  return (
    <form className="animate-fade-in-up flex max-w-xl flex-col gap-4" action={createSession}>
      <RequiredFieldMessages message={dict.common.requiredFieldMessage} />
      {/* The facilitator's language is whatever they've already toggled the
          UI to (see the LanguageSwitcher above this form) — no need to ask
          them to pick it again in a separate field. */}
      <input type="hidden" name="sourceLanguage" value={lang} />
      <label className="flex flex-col gap-2 text-sm font-medium">
        {dict.setup.yourName}
        <input
          className="rounded-lg border border-border-strong bg-surface-raised p-3 text-sm text-foreground outline-none transition-colors duration-150 focus:border-accent focus:ring-2 focus:ring-accent/30"
          name="facilitatorName"
          required
          maxLength={80}
          placeholder={dict.setup.yourNamePlaceholder}
        />
      </label>
      <label className="flex flex-col gap-2 text-sm font-medium">
        {dict.setup.sessionTitle}
        <input
          className="rounded-lg border border-border-strong bg-surface-raised p-3 text-sm text-foreground outline-none transition-colors duration-150 focus:border-accent focus:ring-2 focus:ring-accent/30"
          name="title"
          required
          maxLength={120}
          placeholder={dict.setup.sessionTitlePlaceholder}
        />
      </label>
      <label className="flex flex-col gap-2 text-sm font-medium">
        {dict.setup.workshopGoal}
        <textarea
          className="rounded-lg border border-border-strong bg-surface-raised p-3 text-sm text-foreground outline-none transition-colors duration-150 focus:border-accent focus:ring-2 focus:ring-accent/30"
          rows={4}
          required
          name="goal"
          maxLength={1000}
          placeholder={dict.setup.workshopGoalPlaceholder}
        />
      </label>
      <label className="flex flex-col gap-2 text-sm font-medium">
        {dict.setup.retention}
        <select
          className="rounded-lg border border-border-strong bg-surface-raised p-3 text-sm text-foreground outline-none transition-colors duration-150 focus:border-accent focus:ring-2 focus:ring-accent/30"
          name="retentionDays"
          defaultValue="7"
        >
          {/* The two short options below exist so a retention choice can actually be
              verified working (the cleanup cron deleting a session on schedule) within a
              single demo/testing session, instead of only ever being takeable on faith —
              day-granularity-only made that impossible without waiting a full day. */}
          <option value="0.00347222">{dict.setup.retentionMinutes}</option>
          <option value="0.04166667">{dict.setup.retentionHour}</option>
          <option value="1">{dict.setup.retentionDay}</option>
          <option value="7">{dict.setup.retentionWeek}</option>
          <option value="30">{dict.setup.retentionMonth}</option>
        </select>
      </label>
      <p className="text-sm text-muted-foreground">{dict.setup.privacyNote}</p>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input name="strictPrivacy" type="checkbox" className="h-3.5 w-3.5 accent-[var(--accent)]" />
        {dict.setup.strictPrivacyLabel}
      </label>
      <p className="text-sm text-muted-foreground">{dict.setup.strictPrivacyHint}</p>
      <CreateSessionButton label={dict.setup.submit} pendingLabel={dict.setup.submitting} />
    </form>
  );
}
