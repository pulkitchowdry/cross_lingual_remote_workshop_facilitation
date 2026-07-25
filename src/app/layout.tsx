import type { Metadata } from "next";
import { Hanken_Grotesk, IBM_Plex_Mono, Inter } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/AppShell";

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${heading.variable} ${bodyFont.variable} ${dataFont.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
