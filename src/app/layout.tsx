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
  title: "Workshop Copilot",
  description:
    "Cross-lingual remote workshop facilitation prototype — facilitator dashboard, learner view, and session history.",
};

// Runs before paint so a returning visitor's stored theme applies with no flash.
// Dark is the default whenever nothing is stored yet.
const THEME_INIT_SCRIPT = `
try {
  var stored = localStorage.getItem("theme");
  var theme = stored === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", theme);
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
