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

export const BRAND_ICON_PATH = "/brand/flamenode-icon-512.png";

/** CURRENT `app/layout.tsx` `themeBootstrapCode`, verbatim: sets data-theme before first paint (key `fn-theme`). */
export const THEME_BOOTSTRAP_CODE = `(()=>{var d=document.documentElement;var q=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)');var read=function(){try{var v=localStorage.getItem('fn-theme');return v==='light'||v==='dark'||v==='system'?v:'system'}catch(_){return'system'}};var apply=function(mode){var resolved=mode==='system'?(q&&q.matches?'dark':'light'):mode;d.setAttribute('data-theme',resolved);d.setAttribute('data-theme-preference',mode)};var mode=read();apply(mode);if(q&&mode==='system'){var onChange=function(){if((d.getAttribute('data-theme-preference')||'system')==='system')apply('system')};if(q.addEventListener)q.addEventListener('change',onChange);else if(q.addListener)q.addListener(onChange)}})();`;

/** CURRENT `buildSiteJsonLd` (WebSite + Organization) for the root layout. */
export function buildSiteJsonLd(origin: string = siteOrigin()): Record<string, unknown> {
  const rootUrl = `${origin}/`;
  const organizationId = `${origin}/#organization`;
  const websiteId = `${origin}/#website`;
  const logoId = `${origin}/#logo`;
  const logoUrl = `${origin}${BRAND_ICON_PATH}`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": organizationId,
        name: SITE_NAME,
        url: rootUrl,
        logo: {
          "@type": "ImageObject",
          "@id": logoId,
          url: logoUrl,
          contentUrl: logoUrl,
          width: 512,
          height: 512,
          caption: SITE_NAME,
        },
        image: { "@id": logoId },
      },
      {
        "@type": "WebSite",
        "@id": websiteId,
        url: rootUrl,
        name: SITE_NAME,
        description: DEFAULT_SITE_DESCRIPTION,
        publisher: { "@id": organizationId },
        inLanguage: "ja-JP",
      },
    ],
  };
}

export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/** CURRENT `(public)/layout.tsx`: the GA4 tag exists only when the measurement id is configured. */
export function gaMeasurementId(env: Record<string, string | undefined> = process.env): string | null {
  const id = (env.PUBLIC_GA_MEASUREMENT_ID ?? env.NEXT_PUBLIC_GA_MEASUREMENT_ID)?.trim();
  return id ? id : null;
}

/** Same init script and loader URL as `@next/third-parties` `GoogleAnalytics` (default dataLayer). */
export function gaInitScript(gaId: string): string {
  return `
          window['dataLayer'] = window['dataLayer'] || [];
          function gtag(){window['dataLayer'].push(arguments);}
          gtag('js', new Date());

          gtag('config', '${gaId}' );`;
}
export const gaLoaderSrc = (gaId: string): string => `https://www.googletagmanager.com/gtag/js?id=${gaId}`;

export type PageHead = Readonly<{
  noindex: boolean;
  title: string;
  description: string;
  canonical: string;
  ogTitle: string;
  ogImage: string;
  /** null for a page-specific image: CURRENT emits no size or type for it. */
  ogImageWidth: number | null;
  ogImageHeight: number | null;
  ogImageType: string | null;
  ogImageAlt: string;
  ogType: "website" | "video.other" | "profile";
}>;

/** CURRENT `absoluteUrl`: absolute URLs stay, paths go under the site origin. */
export function absoluteUrl(path: string, origin: string = siteOrigin()): string {
  try {
    return new URL(path).toString();
  } catch {
    return new URL(path.startsWith("/") ? path : `/${path}`, origin).toString();
  }
}

export function buildPageHead(input: {
  path: string;
  title: string;
  description?: string | null;
  noIndex?: boolean;
  /** Page-specific Open Graph image (CURRENT `buildPageMetadata({ image })`); default is the brand card. */
  image?: string | null;
  ogType?: "website" | "video.other" | "profile";
}): PageHead {
  const origin = siteOrigin();
  const base = {
    noindex: input.noIndex === true,
    title: `${input.title} | ${SITE_NAME}`,
    description: compactText(input.description),
    canonical: `${origin}${input.path}`,
    ogTitle: input.title,
    ogType: input.ogType ?? "website",
  } as const;
  if (input.image) {
    return {
      ...base,
      ogImage: absoluteUrl(input.image, origin),
      ogImageWidth: null,
      ogImageHeight: null,
      ogImageType: null,
      ogImageAlt: input.title,
    };
  }
  return {
    ...base,
    ogImage: `${origin}${BRAND_SOCIAL_IMAGE_PATH}`,
    ogImageWidth: 1200,
    ogImageHeight: 630,
    ogImageType: "image/png",
    ogImageAlt: `${SITE_NAME} ロゴ`,
  };
}
