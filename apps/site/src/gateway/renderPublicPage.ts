/**
 * Minimal HTML shell generator for queue-driven ISR page regeneration (MIG-0411 / Recipe R-PAGE / Runtime S1).
 * Approved Option B: minimal HTML head shell (title, canonical, OGP) + client Island root (< 8ms CPU budget).
 * Pure function with zero external I/O, strict escaping, and deterministic output.
 */

export type PageRenderEntityKind = "video" | "user" | "event";

export interface PublicPageVideoRow {
  id: string;
  title: string;
  description?: string | null;
  creator_name?: string | null;
  thumbnail_url?: string | null;
  visibility?: string | null;
}

export interface PublicPageUserRow {
  id: string;
  name?: string | null;
  handle?: string | null;
  bio?: string | null;
  icon_url?: string | null;
}

export interface PublicPageEventRow {
  id: string;
  title: string;
  description?: string | null;
  icon_url?: string | null;
  visibility?: string | null;
}

export type PublicPageRow =
  | PublicPageVideoRow
  | PublicPageUserRow
  | PublicPageEventRow
  | Record<string, unknown>;

export interface RenderPublicPageOptions {
  canonicalOrigin?: string;
  generation?: string;
}

const DEFAULT_ORIGIN = "https://flamenode.net";

function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildCanonicalUrl(
  entity: PageRenderEntityKind,
  id: string,
  origin = DEFAULT_ORIGIN,
): string {
  const cleanOrigin = origin.replace(/\/$/, "");
  switch (entity) {
    case "video":
      return `${cleanOrigin}/${id}`;
    case "user":
      return `${cleanOrigin}/user/${id}`;
    case "event":
      return `${cleanOrigin}/event/${id}`;
  }
}

export function renderPublicPage(
  entity: PageRenderEntityKind,
  row: PublicPageRow,
  options: RenderPublicPageOptions = {},
): string {
  const id = String((row as Record<string, unknown>).id ?? "");
  if (!id) {
    throw new Error(`[renderPublicPage] Missing required id for entity '${entity}'`);
  }

  const origin = options.canonicalOrigin ?? DEFAULT_ORIGIN;
  const canonicalUrl = buildCanonicalUrl(entity, id, origin);

  let title = "FlameNode";
  let description = "";
  let ogType = "website";
  let ogImage: string | undefined = undefined;

  switch (entity) {
    case "video": {
      const v = row as PublicPageVideoRow;
      const rawTitle = v.title || "Video";
      title = `${rawTitle} - FlameNode`;
      description = v.description ?? "";
      ogType = "video.other";
      ogImage = v.thumbnail_url ?? undefined;
      break;
    }
    case "user": {
      const u = row as PublicPageUserRow;
      const rawName = u.name || u.handle || "User";
      title = `${rawName} - FlameNode`;
      description = u.bio ?? "";
      ogType = "profile";
      ogImage = u.icon_url ?? undefined;
      break;
    }
    case "event": {
      const e = row as PublicPageEventRow;
      const rawTitle = e.title || "Event";
      title = `${rawTitle} - FlameNode`;
      description = e.description ?? "";
      ogType = "website";
      ogImage = e.icon_url ?? undefined;
      break;
    }
    default:
      throw new Error(`[renderPublicPage] Unsupported entity kind '${entity}'`);
  }

  const titleEsc = escapeHtml(title);
  const canonicalEsc = escapeHtml(canonicalUrl);
  const ogTypeEsc = escapeHtml(ogType);
  const descEsc = escapeHtml(description);
  const ogImageEsc = ogImage ? escapeHtml(ogImage) : "";
  const idEsc = escapeHtml(id);
  const entityEsc = escapeHtml(entity);

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${titleEsc}</title>
  <link rel="canonical" href="${canonicalEsc}"/>
  <meta property="og:title" content="${titleEsc}"/>
  <meta property="og:type" content="${ogTypeEsc}"/>
  <meta property="og:url" content="${canonicalEsc}"/>
  <meta property="og:site_name" content="FlameNode"/>${
    ogImageEsc ? `\n  <meta property="og:image" content="${ogImageEsc}"/>` : ""
  }${
    descEsc
      ? `\n  <meta name="description" content="${descEsc}"/>\n  <meta property="og:description" content="${descEsc}"/>`
      : ""
  }
</head>
<body>
  <div id="island-root" data-entity="${entityEsc}" data-id="${idEsc}"></div>
</body>
</html>
`;
}
