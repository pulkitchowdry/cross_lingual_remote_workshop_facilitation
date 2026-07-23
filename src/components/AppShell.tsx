"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_LINKS = [
  { href: "/setup", label: "Setup" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/learner", label: "Learner View" },
  { href: "/history", label: "History" },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border-subtle bg-surface shadow-sm">
        <nav className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-4">
          <span className="font-semibold tracking-tight">Workshop Copilot</span>
          <ul className="flex gap-1 text-sm">
            {NAV_LINKS.map((link) => {
              const active = pathname?.startsWith(link.href);
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className={`rounded-full px-3 py-1.5 transition-colors ${
                      active
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-background hover:text-foreground"
                    }`}
                  >
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
