import type { Metadata } from "next";
import { Hanken_Grotesk, IBM_Plex_Mono, Inter } from "next/font/google";
import Script from "next/script";
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

// Same NEXT_PUBLIC_APP_URL override that resolveAppUrl() (src/lib/env.ts) uses for
// invite links — metadataBase can't call resolveAppUrl itself since Metadata is a
// static export evaluated without access to the request's headers.
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const DESCRIPTION =
  "Cross-lingual remote workshop facilitation — live speech-to-text, translation, and AI-generated context (progress, decisions, blockers) so facilitators and learners can communicate across language differences in real time.";

export const metadata: Metadata = {
  // A per-page `title` (see setup/join/facilitator/learn pages) lets each route have a
  // distinct document title, which is what triggers Next's built-in App Router
  // screen-reader route-change announcement — a single unchanging app-wide title never
  // fires it.
  title: { default: "Interlingo", template: "%s — Interlingo" },
  description: DESCRIPTION,
  metadataBase: new URL(APP_URL),
  keywords: [
    "live translation",
    "workshop facilitation",
    "cross-lingual captions",
    "real-time speech-to-text",
    "remote learning",
    "multilingual collaboration",
  ],
  openGraph: {
    title: "Interlingo",
    description: DESCRIPTION,
    url: "/",
    siteName: "Interlingo",
    type: "website",
    images: ["/opengraph-image"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Interlingo",
    description: DESCRIPTION,
    images: ["/opengraph-image"],
  },
  robots: {
    // The app itself is entirely session/auth-gated past setup — nothing here
    // is public content worth indexing, so opt every route out by default;
    // robots.ts below still serves a robots.txt for well-behaved crawlers.
    index: false,
    follow: false,
  },
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
        {/* next/script's beforeInteractive strategy runs this before hydration (avoiding the
            theme-flash) via Next's own injection path, rather than a raw <script> tag React's
            renderer isn't designed to manage. */}
        <Script id="theme-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
