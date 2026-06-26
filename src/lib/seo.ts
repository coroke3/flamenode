import type { Metadata } from "next";
import { looksLikeMojibake } from "@/lib/utils/mojibake";

export const SITE_NAME =
  process.env.NEXT_PUBLIC_SITE_NAME?.trim() || "FlameNode";

const DEFAULT_SITE_DESCRIPTION =
  "映像作品とクリエイター、イベントをつなぐ動画プラットフォーム。";

function readableEnvText(value: string | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  return looksLikeMojibake(text) ? null : text;
}

export const SITE_DESCRIPTION =
  readableEnvText(process.env.NEXT_PUBLIC_SITE_DESCRIPTION) ||
  DEFAULT_SITE_DESCRIPTION;

const FALLBACK_SITE_URL = "http://localhost:3000";

const TITLE_FALLBACKS: Record<string, string> = {
  "/": SITE_NAME,
  "/recommend": "おすすめ",
  "/list": "作品一覧",
  "/event": "イベント",
  "/user": "クリエイター一覧",
  "/about": "FlameNodeについて",
  "/rules": "利用規約",
};

function readableTitle(value: string, path: string): string {
  return readableEnvText(value) ?? TITLE_FALLBACKS[path] ?? SITE_NAME;
}

export function getSiteUrl(): URL {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim() || FALLBACK_SITE_URL;
  try {
    return new URL(new URL(raw).origin);
  } catch {
    return new URL(FALLBACK_SITE_URL);
  }
}

export function absoluteUrl(path = "/"): string {
  try {
    return new URL(path).toString();
  } catch {
    return new URL(path.startsWith("/") ? path : `/${path}`, getSiteUrl()).toString();
  }
}

export function compactText(value: string | null | undefined, max = 160): string {
  const compacted = (value ?? "").replace(/\s+/g, " ").trim();
  if (!compacted) return SITE_DESCRIPTION;
  if (readableEnvText(compacted) == null) return SITE_DESCRIPTION;
  if (compacted.length <= max) return compacted;
  return `${compacted.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

export function buildPageMetadata({
  title,
  description,
  path,
  image,
  noIndex = false,
}: {
  title: string;
  description?: string | null;
  path: string;
  image?: string | null;
  noIndex?: boolean;
}): Metadata {
  const cleanTitle = readableTitle(title, path);
  const cleanDescription = compactText(description);
  const canonical = absoluteUrl(path);
  const imageUrl = absoluteUrl(image || "/logo.png");
  const metadata: Metadata = {
    title: cleanTitle,
    description: cleanDescription,
    alternates: { canonical },
    openGraph: {
      siteName: SITE_NAME,
      title: cleanTitle,
      description: cleanDescription,
      url: canonical,
      type: "website",
      images: [{ url: imageUrl, alt: cleanTitle }],
    },
    twitter: {
      card: "summary_large_image",
      title: cleanTitle,
      description: cleanDescription,
      images: [imageUrl],
    },
  };

  if (noIndex) {
    metadata.robots = {
      index: false,
      follow: false,
      googleBot: { index: false, follow: false },
    };
  }

  return metadata;
}
