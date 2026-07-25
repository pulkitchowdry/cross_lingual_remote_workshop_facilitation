"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AccessibilityPanel } from "@/components/AccessibilityPanel";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getDictionary } from "@/lib/i18n";
import { useUiLanguage } from "@/lib/use-ui-language";
import { logoutFacilitator } from "@/app/sessions/[sessionId]/facilitator/actions";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const lang = useUiLanguage();
  const dict = getDictionary(lang);
  // Learners land on /join (before joining) and /sessions/:id/learn (after) — they
  // never create sessions, so the facilitator-only "New session" entry point is hidden there.
  const isLearnerRoute = pathname?.startsWith("/join") || /^\/sessions\/[^/]+\/learn/.test(pathname ?? "");
  const navLinks = isLearnerRoute ? [] : ([{ href: "/setup", label: dict.shell.newSession }] as const);
  const facilitatorSessionId = pathname?.match(/^\/sessions\/([^/]+)\/facilitator/)?.[1];
  // The live workshop room (video/screen-share + chat) is the one view where the
  // 1600px cap actively wastes space — a facilitator or learner running this on a
  // wide monitor was left with large idle margins on both sides of the video feed.
  // Every other page (setup forms, history, the join flow) reads better narrower,
  // so only these two routes drop the cap rather than lifting it globally.
  const isWorkshopRoomRoute = isLearnerRoute || facilitatorSessionId !== undefined;

  return (
    <div className="flex min-h-full flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-xs focus:font-medium focus:uppercase focus:tracking-wider focus:text-accent-foreground"
      >
        {dict.shell.skipToContent}
      </a>
      <header className="border-b border-border-subtle">
        <nav className="mx-auto flex max-w-[1600px] items-center gap-8 px-6 py-4">
          <span className="flex items-center gap-2">
            <span
              className="h-2 w-2 shrink-0 animate-live-pulse rounded-full bg-accent"
              aria-hidden="true"
            />
            <span className="font-heading font-semibold tracking-tight">
              Workshop Copilot
            </span>
          </span>
          <ul className="flex items-center gap-6">
            {navLinks.map((link) => {
              const active = pathname?.startsWith(link.href);
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className={`font-data border-b-2 pb-1 text-xs font-medium uppercase tracking-wider transition-colors ${
                      active
                        ? "border-accent text-foreground"
                        : "border-transparent text-muted-foreground hover:border-border-strong hover:text-foreground"
                    }`}
                  >
                    {link.label}
                  </Link>
                </li>
              );
            })}
            {facilitatorSessionId && (
              <li>
                <form action={logoutFacilitator.bind(null, facilitatorSessionId)}>
                  <button className="font-data border-b-2 border-transparent pb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground">
                    {dict.facilitator.logOut}
                  </button>
                </form>
              </li>
            )}
          </ul>
          <div className="ml-auto flex items-center gap-2">
            <AccessibilityPanel />
            <ThemeToggle />
            {/* Session pages (facilitator/learn) portal their LanguageMenu button in here — see
                LanguageMenu.tsx — so it renders visually next to the theme toggle even though
                its state (current language, change-language server action) lives in the page. */}
            <div id="header-language-slot" />
          </div>
        </nav>
      </header>
      <main
        id="main-content"
        className={
          isWorkshopRoomRoute
            ? "mx-auto w-full flex-1 px-3 py-6 sm:px-4"
            : "mx-auto w-full max-w-[1600px] flex-1 px-6 py-8"
        }
      >
        {children}
      </main>
    </div>
  );
}
