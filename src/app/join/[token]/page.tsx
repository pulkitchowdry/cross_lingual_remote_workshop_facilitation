import type { Metadata } from "next";
import { Button } from "@/components/ui/Button";
import { notFound } from "next/navigation";
import { ParticipantRole } from "@/generated/prisma/client";
import { joinSession } from "@/app/join/[token]/actions";
import { prisma } from "@/lib/db";
import { hashToken } from "@/lib/session-security";
import { SUPPORTED_LANGUAGES } from "@/lib/session-contracts";
import { getDictionary, resolveLanguage } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { SyncUiLanguage } from "@/components/SyncUiLanguage";

export const metadata: Metadata = { title: "Join session" };

export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { token } = await params;
  const { lang: langParam } = await searchParams;
  const lang = resolveLanguage(langParam);
  const dict = getDictionary(lang);
  const invite = await prisma.joinLink.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { session: true },
  });

  if (
    !invite ||
    invite.role !== ParticipantRole.LEARNER ||
    invite.revokedAt ||
    (invite.expiresAt && invite.expiresAt < new Date()) ||
    (invite.maxUses !== null && invite.useCount >= invite.maxUses)
  ) {
    notFound();
  }

  const learnerLanguageOptions = SUPPORTED_LANGUAGES.filter((language) =>
    invite.session.learnerLanguages.includes(language.value),
  );
  // The facilitator's own language is only a meaningful default when it's
  // actually one of the enabled learner languages — otherwise fall back to
  // the first enabled option explicitly, rather than relying on the browser
  // to silently pick something when defaultValue matches no <option>.
  const defaultLanguage = learnerLanguageOptions.some((language) => language.value === invite.session.sourceLanguage)
    ? invite.session.sourceLanguage
    : learnerLanguageOptions[0]?.value;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <SyncUiLanguage lang={lang} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-data text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {dict.join.invitedTo}
          </p>
          <h1 className="font-heading text-2xl font-semibold">{invite.session.title}</h1>
          <p className="text-sm text-muted-foreground">{dict.join.subtitle}</p>
        </div>
        <LanguageSwitcher current={lang} basePath={`/join/${token}`} />
      </div>
      <form action={joinSession} className="flex flex-col gap-4">
        <input type="hidden" name="token" value={token} />
        <label className="flex flex-col gap-2 text-sm font-medium">
          {dict.join.yourName}
          <input
            className="rounded-lg border border-border-strong bg-surface-raised p-3 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
            name="displayName"
            required
            maxLength={80}
            autoComplete="name"
          />
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium">
          {dict.join.preferredLanguage}
          <select
            className="rounded-lg border border-border-strong bg-surface-raised p-3 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
            name="preferredLanguage"
            defaultValue={defaultLanguage}
          >
            {learnerLanguageOptions.map((language) => (
              <option key={language.value} value={language.value}>
                {dict.languageNames[language.value]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-start gap-3 text-sm text-muted-foreground">
          <input className="mt-1" type="checkbox" name="consent" required />
          <span>{dict.join.consent}</span>
        </label>
        <Button type="submit">{dict.join.submit}</Button>
      </form>
    </div>
  );
}
