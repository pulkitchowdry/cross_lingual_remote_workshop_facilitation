"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/ThemeToggle";

const NAV_LINKS = [{ href: "/setup", label: "New session" }] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border-subtle bg-surface">
        <nav className="mx-auto flex max-w-5xl items-center gap-8 px-6 py-4">
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
            {NAV_LINKS.map((link) => {
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
          <ThemeToggle />
        </nav>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
