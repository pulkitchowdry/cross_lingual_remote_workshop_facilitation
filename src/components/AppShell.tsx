"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AccessibilityPanel } from "@/components/AccessibilityPanel";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getDictionary } from "@/lib/i18n";
import { useUiLanguage } from "@/lib/use-ui-language";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const lang = useUiLanguage();
  const dict = getDictionary(lang);
  const navLinks = [{ href: "/setup", label: dict.shell.newSession }] as const;

  return (
    <div className="flex min-h-full flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-xs focus:font-medium focus:uppercase focus:tracking-wider focus:text-accent-foreground"
      >
        {dict.shell.skipToContent}
      </a>
      <header className="border-b border-border-subtle bg-surface">
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
          <ul className="flex gap-6">
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
          </ul>
          <div className="ml-auto flex items-center gap-2">
            <AccessibilityPanel />
            <ThemeToggle />
          </div>
        </nav>
      </header>
      <main id="main-content" className="mx-auto w-full max-w-[1600px] flex-1 px-6 py-8">
        {children}
      </main>
    </div>
  );
}
