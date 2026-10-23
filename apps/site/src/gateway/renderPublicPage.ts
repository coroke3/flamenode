/**
 * HTML for queue-driven page regeneration (MIG-0411 U02 / R-PAGE / Runtime B).
 *
 * Parity with the build: the same pure mapping as the Astro pages of MIG-0403
 * (`../lib/publicPages.ts`: head metadata + `@flamenode/ui` screen props), the same screen
 * component rendered inside the site adapters (`../components/StaticScreen.ts`), and the
 * same document shell as `../layouts/PublicPage.astro` (written out as a string below
 * because the gateway Worker bundles no Astro runtime). `pageRenderQueue.test.mjs`
 * compares the output with the built `dist` HTML byte for byte, so the shell cannot drift
 * silently. The pages ship no JavaScript: hydration Islands (likes, slots, chapters) are
 * MIG-0502 / MIG-0504 / MIG-0507, for the build and for this renderer alike.
 *
 * The stylesheet link is the one thing the Worker cannot derive: Astro hashes the CSS name
 * per build (`/_astro/_id_.<hash>.css`), so it is configuration (`PUBLIC_PAGE_STYLESHEETS`,
 * MIG-0509 writes it with the build). Without it the page is unstyled, so the consumer
 * writes nothing.
 *
 * Data: `snapshotFromRow` projects the one D1 row into the snapshot shape the build reads
 * (`publicDataLoader.ts`), field for field. Lists and totals are not in the snapshot yet,
 * so both paths render the screens' empty states for them (see publicPages.ts).
 *
 * React and the UI package are loaded on the first render only (dynamic import), so the
 * gateway's request path and the tests that import the gateway do not load them.
 */
import type { CreatorProfileData, EventDetailData, VideoDetailData } from "@flamenode/ui";
import { computeEventStatus, eventStatusLabel, isAcceptingEntries } from "../../../../src/lib/utils/eventStatusCore.ts";
import type { PageMetadata } from "../lib/pageMetadata.ts";
import type {
  EventPublicSnapshot,
  UserPublicSnapshot,
  VideoPublicSnapshot,
} from "../lib/publicDataLoader.ts";
import {
  creatorMetadata,
  creatorScreenData,
  eventMetadata,
  eventScreenData,
  videoMetadata,
  videoScreenData,
} from "../lib/publicPages.ts";

// /user/[id] is PublicLayout + CreatorProfileIsland since MIG-0504; this renderer cannot reproduce Astro island output.
// Island parity is an MIG-0411 follow-up (lead).
export type PageRenderEntityKind = "video" | "user" | "event";

/**
 * "server-rendered": the consumer writes the page. "excluded": it writes nothing and the
 * build keeps serving the kind (Work Order U05, max >= 8 ms).
 *
 * user and event are excluded: /user/[id] (MIG-0504) and /event/[id] (MIG-0502) are Island pages that this
 * renderer cannot reproduce byte-for-byte. video stays server-rendered until MIG-0507 makes it an Island page too. Earlier measurement (renderPublicPage.measure.mjs `--snapshot`, local Node, not workerd; upper-bound
 * inputs video 25-49 ms, event 5-9 ms, user 4-6 ms, project-files/migration-review/pr326-u05a-render-to-string.log)
 * is the budget evidence if a kind is restored.
 */
export const PAGE_BODY_FORMAT: Readonly<Record<PageRenderEntityKind, "server-rendered" | "excluded">> = {
  video: "server-rendered",
  user: "excluded",
  event: "excluded",
};

/** Columns read by pageRenderQueue.ts (real D1 names, see packages/db/src/schema/base.ts). */
export type PublicPageRow = Record<string, unknown>;

export type PublicPageInput =
  | { entity: "video"; video: VideoDetailData }
  | { entity: "user"; creator: CreatorProfileData }
  | { entity: "event"; event: EventDetailData };

export type PublicPageContent = { input: PublicPageInput; meta: PageMetadata };

type Snapshot = VideoPublicSnapshot | UserPublicSnapshot | EventPublicSnapshot;

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** The one entity row as the build's snapshot (same field names as publicDataLoader.ts). */
export function snapshotFromRow(
  entity: PageRenderEntityKind,
  row: PublicPageRow,
  nowSeconds = Math.floor(Date.now() / 1000),
): Snapshot {
  const id = str(row.id);
  if (!id) throw new Error("[renderPublicPage] Missing required id for entity '" + entity + "'");
  switch (entity) {
    case "video":
      return {
        kind: "video",
        id,
        title: str(row.title) ?? id,
        youtubeVideoId: str(row.youtube_video_id),
        creatorName: str(row.creator_display_name),
        creatorXUserId: str(row.creator_x_user_id),
        creatorIconUrl: str(row.creator_icon_url),
        creatorHasPublicProfile: row.creator_has_public_profile === 1 || row.creator_has_public_profile === true,
        creatorYoutubeChannelUrl: str(row.creator_youtube_channel_url),
        scheduledTime: num(row.scheduled_time),
        music: str(row.music),
        credit: str(row.credit),
        introComment: str(row.intro_comment),
        highlights: str(row.highlights),
      };
    case "user": {
      const name = str(row.x_name);
      return {
        kind: "user",
        id,
        title: name ?? id,
        name,
        iconUrl: str(row.icon_url),
        profileText: str(row.profile_text),
        youtubeChannelUrl: str(row.youtube_channel_url),
      };
    }
    case "event": {
      // Status is a build-time value in the snapshot; here it is the render-time value
      // (CURRENT eventStatusCore). Period label: no CURRENT source yet (left to MIG-0502).
      const statusInput = {
        visibility_status: str(row.visibility_status),
        start_time: num(row.start_time) ?? null,
        end_time: num(row.end_time) ?? null,
        entry_start_time: num(row.entry_start_time) ?? null,
        entry_end_time: num(row.entry_end_time) ?? null,
      };
      const accepting = isAcceptingEntries(statusInput, nowSeconds);
      return {
        kind: "event",
        id,
        title: str(row.title) ?? id,
        explanation: str(row.explanation),
        imageUrl: str(row.img_url),
        iconUrl: str(row.icon_url),
        statusLabel: accepting ? "募集期間中" : eventStatusLabel(computeEventStatus(statusInput, nowSeconds)),
        entryAction: accepting ? "reserve" : undefined,
      };
    }
    default:
      throw new Error("[renderPublicPage] Unsupported entity kind '" + String(entity) + "'");
  }
}

/** Head metadata and screen props from the snapshot, exactly as the Astro pages build them. */
export function contentFromSnapshot(snapshot: Snapshot): PublicPageContent {
  switch (snapshot.kind) {
    case "video":
      return { meta: videoMetadata(snapshot), input: { entity: "video", video: videoScreenData(snapshot) } };
    case "user":
      return { meta: creatorMetadata(snapshot), input: { entity: "user", creator: creatorScreenData(snapshot) } };
    case "event":
      return { meta: eventMetadata(snapshot), input: { entity: "event", event: eventScreenData(snapshot) } };
  }
}

/** Astro's escapeHTML: ampersand, angle brackets, double and single quote. */
function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Stylesheets must be build assets of this site (`/_astro/<name>.css`), never another origin. */
const STYLESHEET_PATH = /^\/_astro\/[A-Za-z0-9_.-]+\.css$/;

/** `PUBLIC_PAGE_STYLESHEETS`: comma-separated site paths. Throws (retryable config error) if empty or invalid. */
export function parseStylesheets(value: string | undefined): string[] {
  const list = (value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  if (list.length === 0 || list.some((href) => !STYLESHEET_PATH.test(href))) {
    throw new Error("[renderPublicPage] PUBLIC_PAGE_STYLESHEETS must list /_astro/*.css paths");
  }
  return list;
}

type Renderer = (input: PublicPageInput) => string;
let rendererPromise: Promise<Renderer> | undefined;

/** Loads React, the UI screens and the site adapters once per isolate. */
function loadScreenRenderer(): Promise<Renderer> {
  rendererPromise ??= (async () => {
    const [{ renderToString }, ui, { StaticScreen }] = await Promise.all([
      import("react-dom/server"),
      import("@flamenode/ui"),
      import("../components/StaticScreen.ts"),
    ]);
    return (input: PublicPageInput) => {
      const screen =
        input.entity === "video"
          ? StaticScreen({ screen: ui.VideoDetailView, props: { video: input.video } })
          : input.entity === "user"
            ? StaticScreen({ screen: ui.CreatorView, props: { creator: input.creator } })
            : StaticScreen({ screen: ui.EventDetailView, props: { event: input.event } });
      return renderToString(screen);
    };
  })();
  rendererPromise.catch(() => {
    rendererPromise = undefined;
  });
  return rendererPromise;
}

function metaTag(attr: string, name: string, content: unknown): string {
  return "<meta " + attr + '="' + name + '" content="' + escapeHtml(content) + '">';
}

/** Same tags in the same order as layouts/PublicPage.astro, in Astro's compact output form. */
function headHtml(meta: PageMetadata, stylesheets: readonly string[]): string {
  const { image } = meta;
  return [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#fbfaf5">',
    '<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0b0d10">',
    "<title>" + escapeHtml(meta.documentTitle) + "</title>",
    metaTag("name", "description", meta.description),
    metaTag("name", "robots", meta.robots),
    metaTag("name", "googlebot", meta.googlebot),
    '<link rel="canonical" href="' + escapeHtml(meta.canonical) + '">',
    metaTag("property", "og:title", meta.title),
    metaTag("property", "og:description", meta.description),
    metaTag("property", "og:url", meta.canonical),
    metaTag("property", "og:site_name", "FlameNode"),
    metaTag("property", "og:image", image.url),
    image.width ? metaTag("property", "og:image:width", String(image.width)) : "",
    image.height ? metaTag("property", "og:image:height", String(image.height)) : "",
    image.type ? metaTag("property", "og:image:type", image.type) : "",
    metaTag("property", "og:image:alt", image.alt),
    metaTag("property", "og:type", meta.ogType),
    metaTag("name", "twitter:card", "summary_large_image"),
    metaTag("name", "twitter:title", meta.title),
    metaTag("name", "twitter:description", meta.description),
    metaTag("name", "twitter:image", image.url),
    metaTag("name", "twitter:image:alt", image.alt),
    ...stylesheets.map((href) => '<link rel="stylesheet" href="' + escapeHtml(href) + '">'),
  ].join("");
}

/** Full document: the PublicPage.astro shell around the server-rendered screen. */
export async function renderPublicPageHtml(
  content: PublicPageContent,
  stylesheets: readonly string[],
): Promise<string> {
  const body = (await loadScreenRenderer())(content.input);
  return (
    '<!DOCTYPE html><html lang="ja" data-theme="dark"> <head>' +
    headHtml(content.meta, stylesheets) +
    "</head> <body>  " +
    body +
    "  </body></html>"
  );
}

export type RenderPublicPageOptions = {
  /** `/_astro/*.css` paths of the build (see parseStylesheets). */
  stylesheets: readonly string[];
  /** Unix seconds for the event status label; defaults to now. */
  nowSeconds?: number;
};

export async function renderPublicPage(
  entity: PageRenderEntityKind,
  row: PublicPageRow,
  options: RenderPublicPageOptions,
): Promise<string> {
  return renderPublicPageHtml(contentFromSnapshot(snapshotFromRow(entity, row, options.nowSeconds)), options.stylesheets);
}
