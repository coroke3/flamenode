/**
 * Head metadata for fixed public pages (MIG-0501). Mirrors CURRENT `buildPageMetadata` (`src/lib/seo.ts`):
 * title `"<title> | FlameNode"`, canonical, Open Graph and Twitter card with the brand social image.
 */
export const SITE_NAME = "FlameNode";
export const DEFAULT_SITE_DESCRIPTION = "映像作品とクリエイター、イベントをつなぐ動画プラットフォーム。";
const FALLBACK_SITE_ORIGIN = "https://flamenode.net";
const BRAND_SOCIAL_IMAGE_PATH = "/brand/flamenode-social-card.png";

export function siteOrigin(env: Record<string, string | undefined> = process.env): string {
  try {
    return new URL(env.PUBLIC_SITE_URL?.trim() || FALLBACK_SITE_ORIGIN).origin;
  } catch {
    return FALLBACK_SITE_ORIGIN;
  }
}

/** CURRENT `compactText`: collapse whitespace, cap at `max`, fall back to the site description. */
export function compactText(value: string | null | undefined, max = 160): string {
  const compacted = (value ?? "").replace(/\s+/g, " ").trim();
  if (!compacted) return DEFAULT_SITE_DESCRIPTION;
  if (compacted.length <= max) return compacted;
  return `${compacted.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

export type PageHead = Readonly<{
  title: string;
  description: string;
  canonical: string;
  ogTitle: string;
  ogImage: string;
  ogImageWidth: number;
  ogImageHeight: number;
  ogImageAlt: string;
}>;

export function buildPageHead(input: { path: string; title: string; description?: string | null }): PageHead {
  const origin = siteOrigin();
  return {
    title: `${input.title} | ${SITE_NAME}`,
    description: compactText(input.description),
    canonical: `${origin}${input.path}`,
    ogTitle: input.title,
    ogImage: `${origin}${BRAND_SOCIAL_IMAGE_PATH}`,
    ogImageWidth: 1200,
    ogImageHeight: 630,
    ogImageAlt: `${SITE_NAME} ロゴ`,
  };
}
