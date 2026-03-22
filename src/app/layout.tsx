import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Noto_Serif_SC } from "next/font/google";

import { AmbientGrid } from "@/components/ambient-grid";
import { SiteHeader } from "@/components/site-header";

import "./globals.css";

const notoSerifSc = Noto_Serif_SC({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["500", "700"],
});

const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "LANCHI SIGNAL",
  description: "Event-first workflow for frontier events, people, and pipeline action.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={`${notoSerifSc.variable} ${ibmPlexSans.variable} ${ibmPlexMono.variable}`}>
      <body>
        <AmbientGrid />
        <SiteHeader />
        <main className="page-shell page-shell--main">{children}</main>
      </body>
    </html>
  );
}
