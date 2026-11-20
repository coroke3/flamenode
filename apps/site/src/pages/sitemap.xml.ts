/**
 * MIG-0621 U03 — static Astro sitemap; no per-request DB/R2 reads.
 * All records are projected from build-time, public-only verified snapshots.
 */
import { buildSitemapEntries, publishedSitemapRows, serializeSitemap } from "../lib/sitemap.ts";
import { siteOrigin } from "../lib/pageHead.ts";
import { getEventBuildData } from "../lib/eventData.ts";
import { loadUserBuildData } from "../lib/userData.ts";
import { FIXTURE_VIDEO_DETAIL_PAYLOADS } from "../lib/videoFixtures.ts";
import { extractYoutubeId } from "../../../../src/lib/youtube/id.ts";
import { normalizeStaticVideoDetail } from "../../../../src/lib/publicData/staticVideoDetailCore.ts";
import { snapshotAccessFromEnv, type SnapshotAccess } from "../lib/snapshotEnv.ts";
import {
  loadSitemapVideosSnapshot,
  loadUsersIndexSnapshot,
  loadVideoDetailPayload,
  videoDetailKeys,
  SnapshotBuildError,
  SITEMAP_VIDEOS_KEY,
  type SitemapVideoRow,
  type SitemapVideoSnapshot,
} from "../lib/publicDataLoader.ts";

const EMPTY_VIDEOS: SitemapVideoSnapshot = { generated_at: null, videos: [] };

export async function sitemapVideosOrEmpty(
  access: SnapshotAccess | null,
  warn: (message: string) => void = console.warn,
): Promise<SitemapVideoSnapshot> {
  if (!access) {
    // /[id].astro uses these same fixtures and the CURRENT video-detail normalizer.
    // Avoid importing its page renderer: Node's test runner cannot load its
    // extensionless legacy imports, and the sitemap needs only public metadata.
    const videos = Object.entries(FIXTURE_VIDEO_DETAIL_PAYLOADS).map(([id, raw]) => {
      const detail = normalizeStaticVideoDetail(raw as Parameters<typeof normalizeStaticVideoDetail>[0]);
      if (!detail || detail.video.visibility_status !== "public" || detail.video.id !== id) {
        throw new Error(`[sitemap] fixture ${id} is not a public, matching video detail`);
      }
      return {
        id,
        youtube_video_id: detail.video.youtube_video_id?.trim() || null,
        scheduled_time: detail.video.scheduled_time,
      };
    });
    warn("[sitemap] no build snapshot configured; using published video fixtures");
    return { generated_at: null, videos };
  }
  try {
    return await loadSitemapVideosSnapshot(access.source, access.options);
  } catch (error) {
    // A missing or unpublished optional video index must not fail the entire public build.
    if (error instanceof SnapshotBuildError && (error.code === "NOT_PUBLIC" || error.code === "SNAPSHOT_MISSING")) {
      warn(`[sitemap] ${SITEMAP_VIDEOS_KEY} unavailable: ${error.code}; video URLs omitted`);
      return EMPTY_VIDEOS;
    }
    throw error; // Corruption/hash/generation/source failures must remain fail-closed.
  }
}

/**
 * The video index can contain an out-of-date YouTube alias while the published
 * detail page (and its canonical slug) has already changed. Use the actual
 * public detail snapshots that the static page emitter uses, never the stale
 * index alias alone. These verified reads run at Astro build time, not in R2 Worker requests.
 */
/** Minimal canonical projection: identical CURRENT normalizer and YouTube-ID rule
 * used by the static /[id] builder. Do NOT import the video page renderer here:
 * its legacy extensionless server imports cannot load under the Node unit runner.
 */
export interface EmittedCanonicalVideoPage {
  videoId: string;
  canonicalSlug: string;
  slug: string;
  youtubeId: string | null;
}

function canonicalVideoPage(id: string, raw: unknown, sourceLabel: string): EmittedCanonicalVideoPage {
  const detail = normalizeStaticVideoDetail(raw as Parameters<typeof normalizeStaticVideoDetail>[0]);
  if (!detail || detail.video.visibility_status !== "public" || detail.video.id !== id) {
    throw new Error(`[sitemap] ${sourceLabel} is not a public, matching video detail`);
  }
  const youtubeId = extractYoutubeId(detail.video.youtube_video_id?.trim() || null);
  const canonicalSlug = youtubeId ?? id;
  return { videoId: id, slug: canonicalSlug, canonicalSlug, youtubeId };
}

export async function loadSitemapCanonicalVideoPages(
  access: SnapshotAccess | null,
  candidateVideoIds?: ReadonlySet<string>,
): Promise<EmittedCanonicalVideoPage[]> {
  // The verified sitemap index accepts at most 500 videos. Enforce the same
  // read budget here so direct/future callers cannot trigger unbounded detail
  // reads by supplying an unchecked candidate set.
  if (candidateVideoIds && candidateVideoIds.size > 500) {
    throw new RangeError("[sitemap] video candidate limit exceeded (500)");
  }
  // A configured build must never silently scan every manifest detail when
  // a caller forgets to pass the verified sitemap index's candidate set.
  if (access && !candidateVideoIds) {
    throw new TypeError("[sitemap] verified video candidate set is required");
  }
  if (!access) {
    return Object.entries(FIXTURE_VIDEO_DETAIL_PAYLOADS)
      .filter(([id]) => !candidateVideoIds || candidateVideoIds.has(id))
      .map(([id, raw]) => canonicalVideoPage(id, raw, `fixture:${id}`));
  }
  const manifest = access.options.manifest;
  if (!manifest) throw new Error("[sitemap] configured snapshot manifest is missing");
  const pages: EmittedCanonicalVideoPage[] = [];
  // The sitemap video index has at most 500 entries. Avoid re-reading every
  // manifest-approved detail (potentially thousands) when most cannot appear
  // in the sitemap. The page emitter still independently validates all pages.
  // An allow-list may repeat the same key. Deduplicate it so even duplicate
  // manifest rows cannot multiply the bounded index's verified source reads.
  for (const key of new Set(videoDetailKeys(manifest))) {
    const id = key.slice("snapshot/video-detail/".length, -".json".length);
    if (candidateVideoIds && !candidateVideoIds.has(id)) continue;
    const payload = await loadVideoDetailPayload(access.source, key, access.options);
    pages.push(canonicalVideoPage(id, payload, key));
  }
  return pages;
}

export function sitemapRowsForEmittedVideoPages(
  rows: readonly SitemapVideoRow[],
  pages: readonly EmittedCanonicalVideoPage[],
): SitemapVideoRow[] {
  const canonical = new Map<string, string | null>();
  for (const page of pages) {
    if (page.slug === page.canonicalSlug) canonical.set(page.videoId, page.youtubeId);
  }
  return rows.filter((row) => canonical.has(row.id))
    .map((row) => ({ ...row, youtube_video_id: canonical.get(row.id) ?? null }));
}

export async function GET(): Promise<Response> {
  const access = snapshotAccessFromEnv();
  const [videoBuild, events, users] = await Promise.all([
    (async () => {
      const videos = await sitemapVideosOrEmpty(access);
      // Only snapshot-listed candidates can contribute sitemap URLs. A denied
      // optional index must cause zero video-detail reads, not a full scan.
      const videoPages = await loadSitemapCanonicalVideoPages(
        access, new Set(videos.videos.map((video) => video.id)),
      );
      return { videos, videoPages };
    })(),
    getEventBuildData(),
    loadUserBuildData(),
  ]);
  const { videos, videoPages } = videoBuild;
  let userGeneratedAt: number | null = null;
  if (access && users.index) {
    const index = await loadUsersIndexSnapshot(access.source, access.options);
    const value = Number(index.generated_at);
    if (Number.isFinite(value) && value > 0) userGeneratedAt = value;
  }
  // A public index row is not evidence that its canonical detail URL was emitted.
  // Match the normalized public detail page canonical slugs, not just manifest keys.
  const manifest = access?.options.manifest;
  if (access && !manifest) {
    throw new Error("[sitemap] configured snapshot manifest is missing");
  }
  const publishedVideos = sitemapRowsForEmittedVideoPages(videos.videos, videoPages);
  const publishedEventIds = new Set(events.details.keys());
  const entries = buildSitemapEntries({
    origin: siteOrigin(),
    videos: publishedVideos,
    events: publishedSitemapRows(events.index?.events ?? [], publishedEventIds),
    creators: users.index ?? [],
    generatedAt: [videos.generated_at, events.index?.generatedAt, userGeneratedAt],
  });
  return new Response(serializeSitemap(entries), {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
