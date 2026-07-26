import type { Metadata } from "next";
import { Hanken_Grotesk, IBM_Plex_Mono, Inter } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { resolveLanguageFromAcceptLanguage } from "@/lib/i18n";

const heading = Hanken_Grotesk({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["600", "700"],
});

const bodyFont = Inter({
  variable: "--font-body",
  subsets: ["latin"],
});

const dataFont = IBM_Plex_Mono({
  variable: "--font-data",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  // A per-page `title` (see setup/join/facilitator/learn pages) lets each route have a
  // distinct document title, which is what triggers Next's built-in App Router
  // screen-reader route-change announcement — a single unchanging app-wide title never
  // fires it.
  title: { default: "Workshop Copilot", template: "%s — Workshop Copilot" },
  description:
    "Cross-lingual remote workshop facilitation prototype — facilitator dashboard and learner view with live translated captions.",
};

// Runs before paint so a returning visitor's stored theme and accessibility
// preferences apply with no flash. Slate Night / normal text / standard
// contrast are the defaults whenever nothing is stored yet.
const THEME_INIT_SCRIPT = `
try {
  var stored = localStorage.getItem("theme");
  var validThemes = ["beige", "ink-copper", "slate-night", "warm-dusk"];
  var theme = validThemes.indexOf(stored) !== -1 ? stored : "slate-night";
  document.documentElement.setAttribute("data-theme", theme);

  var fontSize = localStorage.getItem("accessibility-font-size");
  if (fontSize === "large" || fontSize === "x-large") {
    document.documentElement.setAttribute("data-font-size", fontSize);
  }

  var contrast = localStorage.getItem("accessibility-contrast");
  if (contrast === "high") {
    document.documentElement.setAttribute("data-contrast", "high");
  }
} catch (e) {}
`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Only a heuristic (see resolveLanguageFromAcceptLanguage) — the root layout
  // is shared by every route and has no access to a nested page's actual
  // resolved language (searchParams / session / participant data), which
  // `SyncUiLanguage` corrects client-side once that page's own language is known.
  const acceptLanguage = (await headers()).get("accept-language");
  const lang = resolveLanguageFromAcceptLanguage(acceptLanguage);

  return (
    <html
      lang={lang}
      suppressHydrationWarning
      className={`${heading.variable} ${bodyFont.variable} ${dataFont.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/*
          A plain <script> tag here reliably runs (the browser executes a <script> it parses
          from the initial HTML before React ever hydrates, avoiding a theme flash) — but React's
          DEV-mode renderer warns regardless ("Encountered a script tag while rendering React
          component"), and `next/script`'s `beforeInteractive` strategy doesn't avoid it either:
          for an inline (no `src`) script under the App Router, its own implementation
          (node_modules/next/dist/client/script.js) still returns a real `<script>` JSX element,
          just with the content wrapped for Next's runtime — so the exact same warning fires,
          just pointing at that line instead. See dev-console-filter.ts (imported from AppShell,
          which every route mounts) for why this specific, otherwise-unavoidable warning is
          filtered rather than "fixed" by switching components.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
