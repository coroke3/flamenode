/**
 * Server-rendered HTML for queue-driven page regeneration (MIG-0411 U02 / R-PAGE / Runtime B).
 *
 * Format (owner approval 2026-10-18, default applied): (a) the page body is the shared
 * `@flamenode/ui` screen (VideoDetailView / CreatorView / EventDetailView, MIG-0205) rendered
 * to HTML with React `renderToString` inside the site adapters (MIG-0402), so no-JS readers
 * and crawlers get the text as with CURRENT. (b) — an empty Island root, body drawn by JS — is
 * the approved fallback for a kind whose (a) render cannot meet the 8 ms per-message budget at
 * its upper-bound input. (b) needs a client Island loader (a built script that reads the page
 * data and mounts the screen); none exists yet (R-PAGE pages, MIG-0403), so a (b) page would be
 * an empty body for every reader. Until it exists those kinds are "excluded": the consumer
 * writes nothing for them and the build (MIG-0509) keeps serving them (Work Order U05).
 * PAGE_BODY_FORMAT records the result per kind; the measurement is
 * `renderPublicPage.measure.mjs` and docs/migration/work-items/MIG-0411.md.
 *
 * Not `experimental_AstroContainer`: no R-PAGE `.astro` page exists yet (MIG-0403) and the
 * gateway Worker bundles no Astro runtime. For React screens Astro calls the same React
 * server renderer, so this is the dominant cost.
 *
 * React and the UI package are loaded on the first render only (dynamic import), so the
 * gateway's request path and the tests that import the gateway do not load them.
 *
 * Data: `screenDataFromRow` maps the one entity row the consumer reads. Lists and totals
 * (members, chapters, related works, event works / staff / slots, creator works) come from
 * the MIG-0403 page loader; until it exists they are empty, the consumer is not wired to a
 * Queue (no binding) and nothing is served from it in production.
 */
import { computeEventStatus, eventStatusLabel, isAcceptingEntries } from "../../../../src/lib/utils/eventStatusCore.ts";

export type PageRenderEntityKind = "video" | "user" | "event";

/**
 * Local Node, NODE_ENV=production, upper-bound input, max of 300 warm renders, 6 logged runs
 * (2026-10-18, project-files/migration-review/pr326-u05a-render-to-string.log):
 * video 25.3–48.8 ms (100 members, 128 chapters, 30 related) -> (b); event 5.4–8.7 ms
 * (5 of 6 runs ≥ 8 ms) -> (b); user 4.4–5.8 ms -> (a). (b) has no Island loader yet, so
 * video / event are "excluded" (see the file header). Not workerd CPU: re-check with a
 * workerd profile (ZERO_1102 §5) before relying on it.
 */
export const PAGE_BODY_FORMAT: Readonly<Record<PageRenderEntityKind, "server-rendered" | "excluded">> = {
  video: "excluded",
  user: "server-rendered",
  event: "excluded",
};

/** Columns read by pageRenderQueue.ts (real D1 names, see packages/db/src/schema/base.ts). */
export type PublicPageVideoRow = {
  id: string;
  title: string;
  creator_display_name?: string | null;
  creator_x_user_id?: string | null;
  creator_icon_url?: string | null;
  creator_youtube_channel_url?: string | null;
  youtube_video_id?: string | null;
  music?: string | null;
  credit?: string | null;
  music_reference_url?: string | null;
  intro_comment?: string | null;
  highlights?: string | null;
  production_story?: string | null;
  closing_comment?: string | null;
};

export type PublicPageUserRow = {
  id: string;
  x_name?: string | null;
  icon_url?: string | null;
  profile_text?: string | null;
  portfolio_contact?: string | null;
  youtube_channel_url?: string | null;
};

export type PublicPageEventRow = {
  id: string;
  title: string;
  explanation?: string | null;
  icon_url?: string | null;
  img_url?: string | null;
  visibility_status?: string | null;
  start_time?: number | null;
  end_time?: number | null;
  entry_start_time?: number | null;
  entry_end_time?: number | null;
};

export type PublicPageRow = PublicPageVideoRow | PublicPageUserRow | PublicPageEventRow;

// Structural copies of the screen props used here (the full types live in @flamenode/ui).
type Text = string | null | undefined;
type VideoCard = { href: string; title: string; thumbnailUrl?: Text; creatorName?: Text; creatorIconUrl?: Text; durationLabel?: Text; metaLabel?: Text };
export type VideoScreenData = {
  id: string;
  title: string;
  creator: { name: string; xUserId?: Text; iconUrl?: Text; profileHref?: Text; youtubeChannelUrl?: Text };
  hasYoutube: boolean;
  thumbnailUrl?: Text;
  publishedLabel?: Text;
  music?: Text;
  credit?: Text;
  musicReferenceUrl?: Text;
  introComment?: Text;
  softwareLabel?: Text;
  highlights?: Text;
  productionStory?: Text;
  closingComment?: Text;
  primaryEvent?: Record<string, unknown> | null;
  otherEvents?: readonly { id: string; title: string }[];
  members?: readonly Record<string, unknown>[];
  chapters?: readonly Record<string, unknown>[];
  related?: readonly { href: string; title: string; creatorName?: Text; thumbnailUrl?: Text }[];
  likeCount?: number;
};
type CreatorPage = { items: readonly VideoCard[]; total: number; currentPage: number; totalPages: number; pageSize: number; buildHref: (page: number) => string };
export type CreatorScreenData = {
  id: string;
  name: string;
  iconUrl?: Text;
  youtubeChannelUrl?: Text;
  socialLinks?: readonly { label: string; url: string }[];
  profileText?: Text;
  contact?: Text;
  works: CreatorPage;
  collabs: CreatorPage;
};
export type EventScreenData = {
  id: string;
  title: string;
  imageUrl?: Text;
  iconUrl?: Text;
  explanation?: Text;
  statusLabel: string;
  statusTone?: string;
  periodLabel?: Text;
  entryAction: "reserve" | "submit" | null;
  playlistUrl?: Text;
  videoTotal: number;
  creatorTotal: number;
  slotFilled: number;
  slotTotal: number;
  schedule?: readonly { label: string; value: string }[];
  slotParts?: readonly { label: string; filled: number; total: number }[];
  staff?: readonly Record<string, unknown>[];
  videos?: readonly Record<string, unknown>[];
};

export type PublicPageInput =
  | { entity: "video"; video: VideoScreenData }
  | { entity: "user"; creator: CreatorScreenData }
  | { entity: "event"; event: EventScreenData };

export type RenderPublicPageOptions = {
  /** Site origin from configuration (e.g. env PUBLIC_SITE_URL). Required: no default. */
  origin: string;
  /** canonicalPath from the route shard entry, e.g. `/abc`, `/user/x`, `/event/y`. */
  canonicalPath: string;
  /** Unix seconds for the event status label; defaults to now. */
  nowSeconds?: number;
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

function orNull(value: unknown): string | null {
  return text(value) || null;
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

function emptyPage(base: string, param: string): CreatorPage {
  return { items: [], total: 0, currentPage: 1, totalPages: 1, pageSize: 8, buildHref: (page) => (page <= 1 ? base : `${base}?${param}=${page}`) };
}

/** Screen data from the single entity row (see the file header for what is not loaded yet). */
export function screenDataFromRow(
  entity: PageRenderEntityKind,
  row: PublicPageRow,
  options: Pick<RenderPublicPageOptions, "canonicalPath" | "nowSeconds"> = { canonicalPath: "/" },
): PublicPageInput {
  const id = text(row.id);
  if (!id) throw new Error(`[renderPublicPage] Missing required id for entity '${entity}'`);
  switch (entity) {
    case "video": {
      const v = row as PublicPageVideoRow;
      return {
        entity,
        video: {
          id,
          title: text(v.title) || id,
          creator: {
            name: text(v.creator_display_name),
            xUserId: orNull(v.creator_x_user_id),
            iconUrl: orNull(v.creator_icon_url),
            // CURRENT links the profile only for a public profile; not known from this row.
            profileHref: null,
            youtubeChannelUrl: orNull(v.creator_youtube_channel_url),
          },
          hasYoutube: Boolean(text(v.youtube_video_id)),
          music: orNull(v.music),
          credit: orNull(v.credit),
          musicReferenceUrl: orNull(v.music_reference_url),
          introComment: orNull(v.intro_comment),
          highlights: orNull(v.highlights),
          productionStory: orNull(v.production_story),
          closingComment: orNull(v.closing_comment),
        },
      };
    }
    case "user": {
      const u = row as PublicPageUserRow;
      const base = options.canonicalPath;
      return {
        entity,
        creator: {
          id,
          name: text(u.x_name) || id,
          iconUrl: orNull(u.icon_url),
          youtubeChannelUrl: orNull(u.youtube_channel_url),
          profileText: orNull(u.profile_text),
          contact: orNull(u.portfolio_contact),
          works: emptyPage(base, "worksPage"),
          collabs: emptyPage(base, "collabPage"),
        },
      };
    }
    case "event": {
      const e = row as PublicPageEventRow;
      const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
      const statusInput = {
        visibility_status: e.visibility_status,
        start_time: e.start_time ?? null,
        end_time: e.end_time ?? null,
        entry_start_time: e.entry_start_time ?? null,
        entry_end_time: e.entry_end_time ?? null,
      };
      const accepting = isAcceptingEntries(statusInput, now);
      return {
        entity,
        event: {
          id,
          title: text(e.title) || id,
          imageUrl: orNull(e.img_url) ?? orNull(e.icon_url),
          iconUrl: orNull(e.icon_url),
          explanation: orNull(e.explanation),
          statusLabel: accepting ? "募集期間中" : eventStatusLabel(computeEventStatus(statusInput, now)),
          entryAction: accepting ? "reserve" : null,
          videoTotal: 0,
          creatorTotal: 0,
          slotFilled: 0,
          slotTotal: 0,
        },
      };
    }
    default:
      throw new Error(`[renderPublicPage] Unsupported entity kind '${String(entity)}'`);
  }
}

function headOf(input: PublicPageInput): { title: string; description: string; ogType: string; ogImage: string } {
  switch (input.entity) {
    case "video": {
      const v = input.video;
      const creator = text(v.creator.name);
      return {
        title: creator ? `${v.title} - ${creator}` : v.title,
        description: text(v.introComment) || text(v.highlights),
        ogType: "video.other",
        ogImage: text(v.thumbnailUrl) || text(v.creator.iconUrl),
      };
    }
    case "user":
      return { title: input.creator.name, description: text(input.creator.profileText), ogType: "profile", ogImage: text(input.creator.iconUrl) };
    case "event":
      return { title: input.event.title, description: text(input.event.explanation), ogType: "website", ogImage: text(input.event.imageUrl) || text(input.event.iconUrl) };
  }
}

type Renderer = (input: PublicPageInput) => string;
let rendererPromise: Promise<Renderer> | undefined;

/** Loads React, the UI screens and the site adapters once per isolate. */
export function loadScreenRenderer(): Promise<Renderer> {
  rendererPromise ??= (async () => {
    const [{ createElement }, { renderToString }, ui, { SiteAdapterProvider }] = await Promise.all([
      import("react"),
      import("react-dom/server"),
      import("@flamenode/ui"),
      import("../components/SiteAdapterProvider.ts"),
    ]);
    return (input: PublicPageInput) => {
      const screen =
        input.entity === "video"
          ? createElement(ui.VideoDetailView, { video: input.video as never })
          : input.entity === "user"
            ? createElement(ui.CreatorView, { creator: input.creator as never })
            : createElement(ui.EventDetailView, { event: input.event as never });
      return renderToString(createElement(SiteAdapterProvider, null, screen));
    };
  })();
  rendererPromise.catch(() => {
    rendererPromise = undefined;
  });
  return rendererPromise;
}

/**
 * Full document: escaped head (title / canonical / OGP) + the server-rendered screen body.
 * Callers decide whether a kind may be published (PAGE_BODY_FORMAT); the U05 harness
 * renders every kind.
 */
export async function renderPublicPageHtml(
  input: PublicPageInput,
  options: RenderPublicPageOptions,
): Promise<string> {
  const canonicalUrl = buildCanonicalUrl(options.origin, options.canonicalPath);
  const body = `<div id="page-root" data-entity="${escapeHtml(input.entity)}">${(await loadScreenRenderer())(input)}</div>`;
  const { title, description, ogType, ogImage } = headOf(input);
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
${body}
</body>
</html>
`;
}

export async function renderPublicPage(
  entity: PageRenderEntityKind,
  row: PublicPageRow,
  options: RenderPublicPageOptions,
): Promise<string> {
  return renderPublicPageHtml(screenDataFromRow(entity, row, options), options);
}
