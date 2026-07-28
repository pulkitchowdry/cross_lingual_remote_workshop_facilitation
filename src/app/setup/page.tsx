import type { Metadata } from "next";
import { headers } from "next/headers";
import { SetupForm } from "@/components/SetupForm";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { SyncUiLanguage } from "@/components/SyncUiLanguage";
import { detectBrowserLanguage, getDictionary, resolveLanguage } from "@/lib/i18n";

export const metadata: Metadata = { title: "Session setup" };

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang: langParam } = await searchParams;
  // No `?lang=` yet (first visit) — fall back to the browser's own language
  // instead of always defaulting to English.
  const browserDefault = langParam ? undefined : detectBrowserLanguage((await headers()).get("accept-language"));
  const lang = resolveLanguage(langParam, browserDefault);
  const dict = getDictionary(lang).setup;

  return (
    <div className="flex flex-col gap-6">
      <SyncUiLanguage lang={lang} />
      <LanguageSwitcher current={lang} basePath="/setup" />
      <div className="animate-fade-in-down">
        <h1 className="font-heading text-2xl font-semibold">{dict.heading}</h1>
        <p className="text-sm text-muted-foreground">{dict.subtitle}</p>
      </div>
      <SetupForm lang={lang} />
    </div>
  );
}
