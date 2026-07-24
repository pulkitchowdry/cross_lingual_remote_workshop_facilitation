import type { Metadata } from "next";
import { SetupForm } from "@/components/SetupForm";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { SyncUiLanguage } from "@/components/SyncUiLanguage";
import { getDictionary, resolveLanguage } from "@/lib/i18n";

export const metadata: Metadata = { title: "Session setup" };

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang: langParam } = await searchParams;
  const lang = resolveLanguage(langParam);
  const dict = getDictionary(lang).setup;

  return (
    <div className="flex flex-col gap-6">
      <SyncUiLanguage lang={lang} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold">{dict.heading}</h1>
          <p className="text-sm text-muted-foreground">{dict.subtitle}</p>
        </div>
        <LanguageSwitcher current={lang} basePath="/setup" />
      </div>
      <SetupForm lang={lang} />
    </div>
  );
}
