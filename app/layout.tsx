import * as React from "react";
import type { Metadata } from "next";
import {
  Hanken_Grotesk,
  JetBrains_Mono,
  Manrope,
  Noto_Sans_JP,
} from "next/font/google";
import localFont from "next/font/local";
import "@/styles/globals.css";
import "@/styles/mobile-hardening.css";
import {
  BRAND_ICON_PATH,
  BRAND_SOCIAL_IMAGE,
  SITE_DESCRIPTION,
  SITE_NAME,
  absoluteUrl,
  buildSiteJsonLd,
  getSiteUrl,
  serializeJsonLd,
} from "@/lib/seo";

const hankenGrotesk = Hanken_Grotesk({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700", "800", "900"],
  variable: "--font-hanken",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-manrope",
  display: "swap",
});

const notoSansJp = Noto_Sans_JP({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "900"],
  variable: "--font-noto-jp",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600"],
  variable: "--font-jetbrains",
  display: "swap",
});

const flameNodeSans = localFont({
  src: "./fonts/FlameNodeSans.otf",
  variable: "--font-flamenode",
  weight: "400",
  display: "swap",
});

const redesignFontClassName = [
  hankenGrotesk.variable,
  manrope.variable,
  notoSansJp.variable,
  jetbrainsMono.variable,
  flameNodeSans.variable,
].join(" ");

const themeBootstrapCode = `(()=>{var d=document.documentElement;var q=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)');var read=function(){try{var v=localStorage.getItem('fn-theme');return v==='light'||v==='dark'||v==='system'?v:'system'}catch(_){return'system'}};var apply=function(mode){var resolved=mode==='system'?(q&&q.matches?'dark':'light'):mode;d.setAttribute('data-theme',resolved);d.setAttribute('data-theme-preference',mode)};var mode=read();apply(mode);if(q&&mode==='system'){var onChange=function(){if((d.getAttribute('data-theme-preference')||'system')==='system')apply('system')};if(q.addEventListener)q.addEventListener('change',onChange);else if(q.addListener)q.addListener(onChange)}})();`;


export const metadata: Metadata = {
  metadataBase: getSiteUrl(),
  title: { default: SITE_NAME, template: `%s | ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: SITE_NAME, url: absoluteUrl("/") }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  category: "entertainment",
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
    locale: "ja_JP",
    images: [
      {
        url: absoluteUrl(BRAND_SOCIAL_IMAGE.path),
        width: BRAND_SOCIAL_IMAGE.width,
        height: BRAND_SOCIAL_IMAGE.height,
        type: BRAND_SOCIAL_IMAGE.type,
        alt: `${SITE_NAME} ロゴ`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: [
      {
        url: absoluteUrl(BRAND_SOCIAL_IMAGE.path),
        alt: `${SITE_NAME} ロゴ`,
      },
    ],
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
      {
        url: "/brand/flamenode-icon-32.png",
        sizes: "32x32",
        type: "image/png",
      },
      {
        url: BRAND_ICON_PATH,
        sizes: "512x512",
        type: "image/png",
      },
    ],
    shortcut: "/favicon.ico",
    apple: [
      {
        url: "/brand/flamenode-apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  appleWebApp: {
    capable: true,
    title: SITE_NAME,
    statusBarStyle: "black-translucent",
  },
  other: { "msapplication-TileColor": "#c8f21f" },
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
  const siteJsonLd = buildSiteJsonLd();

  return (
    <html
      lang="ja"
      className={redesignFontClassName}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapCode }} />
        <script
          id="flamenode-site-structured-data"
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(siteJsonLd) }}
        />
      </head>
      <body className="min-h-screen flex flex-col">{children}</body>
    </html>
  );
}
