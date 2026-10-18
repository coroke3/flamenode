/**
 * Minimal HTML shell for queue-driven page regeneration (MIG-0411 / R-PAGE / Runtime B).
 * Pure: no I/O, deterministic, every value escaped.
 *
 * NOT APPROVED AS THE PAGE FORMAT. The Work Order (U02) asks for the R-PAGE page
 * component rendered with `renderToString`; this shell (title / canonical / OGP + an
 * empty Island root) is the "(b)" variant whose STOP requires the user's approval
 * because the body would be drawn by JS (no-JS and crawler text differ from CURRENT).
 * Head values follow the real D1 columns but are not verified against CURRENT
 * `generateMetadata` output.
 */

export type PageRenderEntityKind = "video" | "user" | "event";

/** Columns read by pageRenderQueue.ts (real D1 names, see packages/db/src/schema/base.ts). */
export type PublicPageVideoRow = {
  id: string;
  title: string;
  creator_display_name?: string | null;
  creator_icon_url?: string | null;
  intro_comment?: string | null;
  highlights?: string | null;
};

export type PublicPageUserRow = {
  id: string;
  x_name?: string | null;
  icon_url?: string | null;
  profile_text?: string | null;
};

export type PublicPageEventRow = {
  id: string;
  title: string;
  explanation?: string | null;
  icon_url?: string | null;
  img_url?: string | null;
};

export type PublicPageRow = PublicPageVideoRow | PublicPageUserRow | PublicPageEventRow;

export type RenderPublicPageOptions = {
  /** Site origin from configuration (e.g. env PUBLIC_SITE_URL). Required: no default. */
  origin: string;
  /** canonicalPath from the route shard entry, e.g. `/abc`, `/user/x`, `/event/y`. */
  canonicalPath: string;
};

function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function buildCanonicalUrl(origin: string, canonicalPath: string): string {
  const base = new URL(origin);
  if (base.protocol !== "https:" && base.protocol !== "http:") {
    throw new Error("[renderPublicPage] origin must be http(s)");
  }
  if (!canonicalPath.startsWith("/") || canonicalPath.startsWith("//")) {
    throw new Error("[renderPublicPage] canonicalPath must be a same-site path");
  }
  return new URL(canonicalPath, base.origin).toString();
}

export function renderPublicPage(
  entity: PageRenderEntityKind,
  row: PublicPageRow,
  options: RenderPublicPageOptions,
): string {
  const id = text(row.id);
  if (!id) throw new Error(`[renderPublicPage] Missing required id for entity '${entity}'`);
  const canonicalUrl = buildCanonicalUrl(options.origin, options.canonicalPath);

  let title: string;
  let description: string;
  let ogType: string;
  let ogImage: string;
  switch (entity) {
    case "video": {
      const v = row as PublicPageVideoRow;
      const creator = text(v.creator_display_name);
      title = creator ? `${text(v.title) || id} - ${creator}` : text(v.title) || id;
      description = text(v.intro_comment) || text(v.highlights);
      ogType = "video.other";
      ogImage = text(v.creator_icon_url);
      break;
    }
    case "user": {
      const u = row as PublicPageUserRow;
      title = text(u.x_name) || id;
      description = text(u.profile_text);
      ogType = "profile";
      ogImage = text(u.icon_url);
      break;
    }
    case "event": {
      const e = row as PublicPageEventRow;
      title = text(e.title) || id;
      description = text(e.explanation);
      ogType = "website";
      ogImage = text(e.img_url) || text(e.icon_url);
      break;
    }
    default:
      throw new Error(`[renderPublicPage] Unsupported entity kind '${String(entity)}'`);
  }

  const titleEsc = escapeHtml(title);
  const canonicalEsc = escapeHtml(canonicalUrl);
  const descEsc = escapeHtml(description);
  const imageEsc = escapeHtml(ogImage);

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${titleEsc}</title>
  <link rel="canonical" href="${canonicalEsc}"/>
  <meta property="og:title" content="${titleEsc}"/>
  <meta property="og:type" content="${escapeHtml(ogType)}"/>
  <meta property="og:url" content="${canonicalEsc}"/>${
    imageEsc ? `\n  <meta property="og:image" content="${imageEsc}"/>` : ""
  }${
    descEsc
      ? `\n  <meta name="description" content="${descEsc}"/>\n  <meta property="og:description" content="${descEsc}"/>`
      : ""
  }
</head>
<body>
  <div id="island-root" data-entity="${escapeHtml(entity)}" data-id="${escapeHtml(id)}"></div>
</body>
</html>
`;
}
