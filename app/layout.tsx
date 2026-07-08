import * as React from "react";
import type { Metadata } from "next";
import "@/styles/globals.css";
import "@/styles/mobile-hardening.css";
import { redesignFontClassName } from "@/components/layout/RedesignFonts";
import { ThemeBootstrap } from "@/components/layout/ThemeBootstrap";
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  absoluteUrl,
  getSiteUrl,
} from "@/lib/seo";

export const runtime = "edge";

export const metadata: Metadata = {
  metadataBase: getSiteUrl(),
  title: { default: SITE_NAME, template: `%s | ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  alternates: { canonical: absoluteUrl("/") },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: absoluteUrl("/"),
    type: "website",
    images: [{ url: absoluteUrl("/logo.png"), alt: SITE_NAME }],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: [absoluteUrl("/logo.png")],
  },
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf5" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0d10" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <html
      lang="ja"
      className={redesignFontClassName}
      data-theme="dark"
      suppressHydrationWarning
    >
      <head>
        <ThemeBootstrap />
      </head>
      <body className="min-h-screen flex flex-col">{children}</body>
    </html>
  );
}
