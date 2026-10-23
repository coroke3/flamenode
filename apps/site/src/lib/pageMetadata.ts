/**
 * `<head>` metadata for public Astro pages, with the same rules as CURRENT
 * `buildPageMetadata` (`src/lib/seo.ts`) plus the root layout title template
 * (`app/layout.tsx`: `%s | FlameNode`) and robots. Build-time only (Runtime S0).
 *
 * Not ported: CURRENT replaces mojibake titles/descriptions with the site
 * defaults (`looksLikeMojibake`). Snapshot text is expected to be clean; a
 * generator-side check belongs to the snapshot generator (MIG-0411 / MIG-0509).
 * Parity with CURRENT is tested in `representativePages.test.mjs`.
 */

/** CURRENT production origin (DEPLOY.md: `NEXT_PUBLIC_SITE_URL` after custom-domain cutover). */
const SITE_ORIGIN = "https://flamenode.net";
export const SITE_NAME = "FlameNode";
const SITE_DESCRIPTION = "映像作品とクリエイター、イベントをつなぐ動画プラットフォーム。";

const BRAND_SOCIAL_IMAGE = {
  path: "/brand/flamenode-social-card.png",
  width: 1200,
  height: 630,
  type: "image/png",
} as const;

/** Root layout `robots` (pages that are public do not override it). */
const ROBOTS = "index, follow";
const GOOGLEBOT = "index, follow, max-video-preview:-1, max-image-preview:large, max-snippet:-1";

export type OgType = "website" | "video.other" | "profile";

export interface PageImage {
  url: string;
  alt: string;
  width?: number;
  height?: number;
  type?: string;
}

export interface PageMetadata {
  /** Document `<title>`, with the layout template applied. */
  documentTitle: string;
  /** og:title / twitter:title (no template, as in CURRENT). */
  title: string;
  description: string;
  canonical: string;
  ogType: OgType;
  image: PageImage;
  robots: string;
  googlebot: string;
}

/** CURRENT `absoluteUrl`: absolute URLs stay, paths resolve against the site origin. */
function absoluteUrl(path: string): string {
  try {
    return new URL(path).toString();
  } catch {
    return new URL(path.startsWith("/") ? path : `/${path}`, SITE_ORIGIN).toString();
  }
}

/** CURRENT `compactText`: collapse whitespace, fall back to the site description, cut at 160. */
function compactText(value: string | null | undefined, max = 160): string {
  const compacted = (value ?? "").replace(/\s+/g, " ").trim();
  if (!compacted) return SITE_DESCRIPTION;
  if (compacted.length <= max) return compacted;
  return `${compacted.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

export function buildPageMetadata({
  title,
  description,
  path,
  image,
  ogType = "website",
}: {
  title: string;
  description?: string | null;
  path: string;
  image?: string | null;
  ogType?: OgType;
}): PageMetadata {
  const cleanTitle = title.trim() || SITE_NAME;
  const imageMetadata: PageImage = image
    ? { url: absoluteUrl(image), alt: cleanTitle }
    : {
        url: absoluteUrl(BRAND_SOCIAL_IMAGE.path),
        alt: `${SITE_NAME} ロゴ`,
        width: BRAND_SOCIAL_IMAGE.width,
        height: BRAND_SOCIAL_IMAGE.height,
        type: BRAND_SOCIAL_IMAGE.type,
      };
  return {
    documentTitle: `${cleanTitle} | ${SITE_NAME}`,
    title: cleanTitle,
    description: compactText(description),
    canonical: absoluteUrl(path),
    ogType,
    image: imageMetadata,
    robots: ROBOTS,
    googlebot: GOOGLEBOT,
  };
}
