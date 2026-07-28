"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AccessibilityPanel } from "@/components/AccessibilityPanel";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NewSessionLink } from "@/components/NewSessionLink";
import "@/lib/dev-console-filter";
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
  const navLinks = isLearnerRoute
    ? []
    : ([
        { href: "/sessions", label: dict.shell.sessions, confirmBeforeLeavingSession: false },
        { href: "/setup", label: dict.shell.newSession, confirmBeforeLeavingSession: true },
      ] as const);
  const facilitatorSessionId = pathname?.match(/^\/sessions\/([^/]+)\/facilitator/)?.[1];
  // The rest of the app is capped at 1000px (see <main> below) for readability. The
  // one exception is the live workshop room itself (video/screen-share + chat) —
  // that view genuinely wants the full viewport for the video grid, so only the
  // /room subpage (not the whole facilitator/learn section, e.g. not the pre-live
  // "waiting for facilitator"/join screens) drops the cap.
  const isLiveVideoRoomRoute = /^\/sessions\/[^/]+\/(facilitator|learn)\/room(\/|$)/.test(
    pathname ?? "",
  );

  return (
    <div className="flex min-h-full flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent-fill focus:px-4 focus:py-2 focus:text-xs focus:font-medium focus:uppercase focus:tracking-wider focus:text-accent-foreground"
      >
        {dict.shell.skipToContent}
      </a>
      <header className="border-b border-border-subtle">
        {/* flex-wrap + gap-y: without it, this row (wordmark + nav links + the
            accessibility/theme/language controls) has no responsive collapse at all and
            overflows horizontally on any narrow viewport (~375-428px, confirmed down to
            a plain narrow desktop window, not just mobile emulation) — the controls div
            gets clipped off-screen, reachable only by scrolling the whole page
            sideways, on every route including the accessibility panel's own page. */}
        <nav className="mx-auto flex max-w-[1000px] flex-wrap items-center gap-x-8 gap-y-2 px-6 py-4">
          <span className="flex items-center gap-2">
            <span
              className="h-2 w-2 shrink-0 animate-live-pulse rounded-full bg-accent"
              aria-hidden="true"
            />
            <span className="font-heading font-semibold tracking-tight">
              Interlingo
            </span>
          </span>
          <ul className="flex items-center gap-6">
            {navLinks.map((link) => {
              const active = pathname?.startsWith(link.href);
              // Clicking straight through to /setup from an existing facilitator
              // dashboard risks orphaning a still-LIVE session (see NewSessionLink's own
              // doc comment) — confirm first there; everywhere else this link appears
              // (e.g. the setup page's own header), there's no existing session to lose.
              if (facilitatorSessionId && link.confirmBeforeLeavingSession) {
                return (
                  <li key={link.href}>
                    <NewSessionLink
                      label={link.label}
                      title={dict.shell.confirmNewSessionTitle}
                      body={dict.shell.confirmNewSessionBody}
                      confirmLabel={dict.common.confirm}
                      cancelLabel={dict.common.cancel}
                    />
                  </li>
                );
              }
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
        // `<main>` isn't natively focusable, so activating the "Skip to main content"
        // link above only scrolls Safari to it without moving keyboard focus there —
        // Chrome/Firefox do both. `tabIndex={-1}` makes it a valid focus target
        // (still excluded from the normal Tab order) without changing anything visual.
        tabIndex={-1}
        className={
          isLiveVideoRoomRoute
            ? // Full viewport width for the live video grid — no cap, no side padding.
              "w-full max-w-none flex-1"
            : "mx-auto w-full max-w-[1000px] flex-1 px-6 py-8"
        }
      >
        {children}
      </main>
    </div>
  );
}
