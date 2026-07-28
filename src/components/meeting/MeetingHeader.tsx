"use client";

import { useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { CopyIcon } from "@/components/meeting/icons";
import { AccessibilityPanel } from "@/components/AccessibilityPanel";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageMenu } from "@/components/LanguageMenu";
import { getDictionary } from "@/lib/i18n";
import type { SupportedLanguage } from "@/lib/session-contracts";

/** Distinct from AppShell's own `#header-language-slot` — that one sits behind this
 * page's full-viewport takeover (see AppShell's `fixed inset-0` comment on the room
 * routes), so a LanguageMenu portalled there would be invisible here. */
const MEETING_HEADER_LANGUAGE_SLOT_ID = "meeting-header-language-slot";

/**
 * Slim top bar for the full-page room — the only chrome visible once the
 * dashboard's header/nav is hidden behind this page's own full-viewport
 * takeover. Carries the same accessibility/theme/language controls AppShell's
 * header normally provides, since that header is unreachable here, plus the
 * copy-link icon, which only appears when an invite link was passed in
 * (facilitators only — learners have no link of their own to share in this
 * app's join model).
 */
export function MeetingHeader({
  title,
  inviteLink,
  uiLang,
  currentLanguage,
  onChangeLanguage,
  languageOptions,
  languageChangeWarning,
}: {
  title: string;
  inviteLink?: string | null;
  uiLang: SupportedLanguage;
  currentLanguage: SupportedLanguage;
  onChangeLanguage: (lang: SupportedLanguage) => Promise<void>;
  languageOptions?: readonly { value: SupportedLanguage; nativeLabel: string }[];
  languageChangeWarning?: string;
}) {
  const dict = getDictionary(uiLang).meeting;
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function copyLink() {
    if (!inviteLink) return;
    try {
      // `navigator.clipboard` itself can be entirely absent (an insecure/http
      // context, or a browser old enough to have no Clipboard API at all — e.g.
      // Safari before 13.1) rather than merely rejecting `writeText` — calling
      // `.writeText` directly on `undefined` would throw a plain TypeError instead
      // of the DOMException this catch block otherwise expects, but either way the
      // user still needs the same visible "it didn't work" feedback.
      if (!navigator.clipboard) throw new Error("Clipboard API unavailable.");
      await navigator.clipboard.writeText(inviteLink);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
    setTimeout(() => setCopyStatus("idle"), 2000);
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 gap-y-2 border-b border-border-subtle bg-surface px-4 py-2.5">
      <h1 className="font-heading min-w-0 truncate text-sm font-semibold text-foreground" title={title}>
        {title}
      </h1>
      {inviteLink && (
        <Tooltip.Provider>
          <Tooltip.Root delayDuration={300}>
            <Tooltip.Trigger asChild>
              <button
                type="button"
                onClick={() => void copyLink()}
                aria-label={dict.copyInviteLink}
                className="press-scale flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground"
              >
                <CopyIcon className="h-4 w-4" />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                side="bottom"
                sideOffset={6}
                className="font-data z-50 max-w-[16rem] rounded-md border border-border-strong bg-surface-raised px-2 py-1 text-center text-[0.6875rem] uppercase tracking-wider text-foreground shadow-sm"
              >
                {copyStatus === "copied" ? dict.linkCopied : copyStatus === "failed" ? dict.copyLinkFailed : dict.copyInviteLink}
                <Tooltip.Arrow style={{ fill: "var(--surface-raised)" }} />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </Tooltip.Provider>
      )}
      <div className="ml-auto flex items-center gap-2">
        <AccessibilityPanel />
        <ThemeToggle />
        <div id={MEETING_HEADER_LANGUAGE_SLOT_ID} />
      </div>
      <LanguageMenu
        current={currentLanguage}
        languages={languageOptions}
        onSelect={onChangeLanguage}
        slotId={MEETING_HEADER_LANGUAGE_SLOT_ID}
        liveWarning={languageChangeWarning}
      />
    </div>
  );
}
