import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ParticipantRole, SessionStatus } from "@/generated/prisma/client";
import { joinSession } from "@/app/join/[token]/actions";
import { prisma } from "@/lib/db";
import { learnerParticipantId } from "@/lib/session-access";
import { hashToken } from "@/lib/session-security";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/lib/session-contracts";
import { detectBrowserLanguage, getDictionary, resolveLanguage } from "@/lib/i18n";
import { isSessionRetentionExpired } from "@/lib/session-retention";
import { resolveTranslatedText } from "@/lib/translation-view";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { SyncUiLanguage } from "@/components/SyncUiLanguage";
import { JoinSubmitButton } from "@/components/JoinSubmitButton";
import { RequiredFieldMessages } from "@/components/RequiredFieldMessages";

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
  const invite = await prisma.joinLink.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { session: { include: { translations: true } } },
  });

  // A learner revisiting their own invite link (bookmarked/shared link opened again
  // after already joining) shouldn't see the join form a second time — send them
  // straight back into the session they already joined. `learnerParticipantId` reads a
  // cookie scoped to one sessionId (see session-access.ts), so this is checked against
  // invite.session.id specifically — the same session the token itself resolves to, not
  // just "any learner cookie exists somewhere". Checked before the invite-validity gate
  // below so it still applies even if the invite link has since been revoked/expired or
  // the session has ended in the meantime.
  if (invite) {
    const existingParticipantId = await learnerParticipantId(invite.session.id);
    if (existingParticipantId) {
      redirect(`/sessions/${invite.session.id}/learn`);
    }
  }

  if (
    !invite ||
    invite.role !== ParticipantRole.LEARNER ||
    invite.revokedAt ||
    (invite.expiresAt && invite.expiresAt < new Date()) ||
    (invite.maxUses !== null && invite.useCount >= invite.maxUses) ||
    // A facilitator ending a session doesn't revoke its (separately-optional) learner
    // invite link — without this, the join form would keep rendering normally for an
    // already-concluded workshop (see the matching, more detailed comment in
    // actions.ts's `joinSession`, which enforces the same check server-side).
    invite.session.status === SessionStatus.ENDED ||
    // The join link's own expiry above is a much longer, independent window (30 days
    // by default) than the session's own retention deadline — without this, the join
    // form would render normally for a session that's already past retention (the
    // hourly cleanup cron hasn't physically deleted it yet), and only fail once the
    // learner submits (see the matching check in actions.ts's `joinSession`).
    isSessionRetentionExpired(invite.session)
  ) {
    // Rendered inline instead of calling notFound() — that shared boundary
    // (not-found.tsx) pairs the same "ask the facilitator for a fresh link" copy with a
    // "Start a new session" CTA pointing at /setup, a facilitator-only action. The
    // learner hitting a dead invite link (the overwhelmingly common trigger for that
    // shared page, per its own doc comment) can't use that CTA at all — there's nothing
    // productive to click here; the real recovery ("ask them for a fresh link") already
    // requires stepping outside the app.
    const fallbackLang = detectBrowserLanguage((await headers()).get("accept-language"));
    const fallbackDict = getDictionary(fallbackLang);
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-4">
        <SyncUiLanguage lang={fallbackLang} />
        <p className="font-data text-xs font-medium uppercase tracking-wider text-muted-foreground">404</p>
        <h1 className="font-heading text-2xl font-semibold">{fallbackDict.notFound.title}</h1>
        <p className="max-w-md text-sm text-muted-foreground">{fallbackDict.notFound.message}</p>
      </div>
    );
  }

  const learnerLanguageOptions = SUPPORTED_LANGUAGES.filter((language) =>
    invite.session.learnerLanguages.includes(language.value),
  );
  // The facilitator's own language is only a meaningful default when it's
  // actually one of the enabled learner languages — otherwise fall back to
  // the first enabled option explicitly, rather than relying on the browser
  // to silently pick something when defaultValue matches no <option>.
  const sourceLanguageDefault: SupportedLanguage | undefined = learnerLanguageOptions.some(
    (language) => language.value === invite.session.sourceLanguage,
  )
    ? (invite.session.sourceLanguage as SupportedLanguage)
    : learnerLanguageOptions[0]?.value;
  // No `?lang=` yet (first visit) — fall back to the browser's own language
  // instead of always defaulting to English, so the invite reads naturally
  // for whoever opens the link before they've clicked anything.
  const browserDefault = langParam ? undefined : detectBrowserLanguage((await headers()).get("accept-language"), sourceLanguageDefault);
  const lang = resolveLanguage(langParam, browserDefault ?? sourceLanguageDefault);
  const dict = getDictionary(lang);
  // The session title is facilitator-authored, in session.sourceLanguage — translated
  // once at createSession() time into every SUPPORTED_LANGUAGES entry (see
  // SessionTranslation/setup/actions.ts), same lookup-by-viewer-language pattern as
  // TranscriptSegment/Translation. Falls back to "Translation unavailable" (not the
  // untranslated original) when no row exists for `lang`, matching every other
  // per-viewer-translated surface in this app (captions, chat).
  const resolvedTitle = resolveTranslatedText(
    {
      language: invite.session.sourceLanguage,
      originalText: invite.session.title,
      translations: invite.session.translations
        .filter((translation) => translation.title != null)
        .map((translation) => ({ targetLanguage: translation.targetLanguage, text: translation.title! })),
    },
    lang,
  );

  return (
    <div className="animate-fade-in-up mx-auto flex max-w-xl flex-col gap-6">
      <SyncUiLanguage lang={lang} />
      <div className="animate-fade-in-down flex flex-col gap-1.5">
        {/* Visible label, not just the group's aria-label below — a sighted user scanning
            the page shouldn't have to infer from the subtitle paragraph further down that
            these pills are also the caption/translation language, not just cosmetic UI
            chrome (every other page's identical-looking pill row really is cosmetic-only). */}
        <p className="font-data text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {dict.join.languagePickerLabel}
        </p>
        <LanguageSwitcher
          current={lang}
          basePath={`/join/${token}`}
          languages={learnerLanguageOptions}
          ariaLabel={dict.join.languagePickerLabel}
        />
      </div>
      <div className="min-w-0">
        <p className="font-data text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {dict.join.invitedTo}
        </p>
        <h1 className="font-heading break-words text-2xl font-semibold" lang={resolvedTitle.hasTranslation ? resolvedTitle.lang : lang}>
          {resolvedTitle.hasTranslation ? resolvedTitle.text : dict.common.translationUnavailable}
        </h1>
        <p className="text-sm text-muted-foreground">{dict.join.subtitle}</p>
      </div>
      <form action={joinSession} className="flex flex-col gap-4">
        <RequiredFieldMessages message={dict.common.requiredFieldMessage} />
        <input type="hidden" name="token" value={token} />
        {/* The learner's preferred language is whatever they've already
            toggled the UI to (see the LanguageSwitcher above this form) — no
            need to ask them to pick it again in a separate field. */}
        <input type="hidden" name="preferredLanguage" value={lang} />
        <label className="flex flex-col gap-2 text-sm font-medium">
          {dict.join.yourName}
          <input
            className="min-w-0 rounded-lg border border-border-strong bg-surface-raised p-3 text-sm text-foreground outline-none transition-colors duration-150 focus:border-accent focus:ring-2 focus:ring-accent/30"
            name="displayName"
            required
            maxLength={80}
            autoComplete="name"
          />
        </label>
        <label className="flex items-start gap-3 text-sm text-muted-foreground">
          <input className="mt-1 h-3.5 w-3.5 accent-[var(--accent)] transition-transform duration-150" type="checkbox" name="consent" required />
          <span>{dict.join.consent}</span>
        </label>
        <JoinSubmitButton label={dict.join.submit} submittingLabel={dict.join.submitting} />
      </form>
    </div>
  );
}
