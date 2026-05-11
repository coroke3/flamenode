import * as React from "react";
import type { Metadata } from "next";
import "@/styles/globals.css";
import { ThemeBootstrap } from "@/components/layout/ThemeBootstrap";

const SITE_NAME = "FlameNode";
const SITE_DESCRIPTION =
  "映像（フレーム）の結節点（ノード）。YouTube埋め込みを利用した動画プラットフォーム。イベント参加手続きと第三者イベント開催に対応。";

export const metadata: Metadata = {
  title: { default: SITE_NAME, template: `%s | ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
  },
};

export const viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0d10" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        <ThemeBootstrap />
      </head>
      <body className="min-h-screen flex flex-col">{children}</body>
    </html>
  );
}
