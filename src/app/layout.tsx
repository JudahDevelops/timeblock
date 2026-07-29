import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      {/* `h-full` + `overflow-hidden`, not `min-h-full`: the calendar owns its
          own scroll, and a growable body would let the grid stretch the
          document instead, leaving the lower hours unreachable. */}
      <body className="flex h-full flex-col overflow-hidden">{children}</body>
    </html>
  );
}
