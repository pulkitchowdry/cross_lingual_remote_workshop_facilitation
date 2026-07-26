"use client";

import { useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { CopyIcon } from "@/components/meeting/icons";
import { getDictionary } from "@/lib/i18n";
import type { SupportedLanguage } from "@/lib/session-contracts";

/**
 * Slim top-left title bar for the full-page room — the only chrome visible
 * once the dashboard's header/nav is gone. The copy-link icon only appears
 * when an invite link was passed in (facilitators only — learners have no
 * link of their own to share in this app's join model).
 */
export function MeetingHeader({
  title,
  inviteLink,
  uiLang,
}: {
  title: string;
  inviteLink?: string | null;
  uiLang: SupportedLanguage;
}) {
  const dict = getDictionary(uiLang).meeting;
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied by the browser — the tooltip still
      // shows the raw link on hover, so this fails silently.
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-border-subtle bg-surface px-4 py-2.5">
      <h1 className="font-heading truncate text-sm font-semibold text-foreground" title={title}>
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
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground"
              >
                <CopyIcon className="h-3.5 w-3.5" />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                side="bottom"
                sideOffset={6}
                className="font-data z-50 max-w-[16rem] rounded-md border border-border-strong bg-surface-raised px-2 py-1 text-center text-[0.6875rem] uppercase tracking-wider text-foreground shadow-sm"
              >
                {copied ? dict.linkCopied : dict.copyInviteLink}
                <Tooltip.Arrow style={{ fill: "var(--surface-raised)" }} />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </Tooltip.Provider>
      )}
    </div>
  );
}
