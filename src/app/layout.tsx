import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Timeblock",
  description: "A calendar where every block of time is a page you work inside.",
  // iOS reads these rather than the manifest's `display`, and without them a
  // home-screen launch is a Safari tab wearing an icon.
  appleWebApp: {
    capable: true,
    title: "Timeblock",
    // Not `black-translucent`, which pulls the page up under the clock. The
    // toolbar has no safe-area padding to give it, so the status bar keeps its
    // own strip and takes its colour from `themeColor` below.
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  // Matched to `--surface`. On a phone this is the strip behind the status bar,
  // and left unset it renders white above a dark calendar.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The theme class is written onto this element before React sees it, so the
    // server's markup and the client's first read genuinely differ. That is the
    // point, and the warning about it is noise.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Blocking, and ahead of the first paint. Deferring this to hydration
            would show the light palette first and swap to dark a moment later,
            across a viewport that is almost entirely calendar. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      {/* `h-full` + `overflow-hidden`, not `min-h-full`: the calendar owns its
          own scroll, and a growable body would let the grid stretch the
          document instead, leaving the lower hours unreachable. */}
      <body className="flex h-full flex-col overflow-hidden">{children}</body>
    </html>
  );
}
