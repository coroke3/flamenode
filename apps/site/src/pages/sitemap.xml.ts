/**
 * MIG-0621 U03 — static Astro sitemap; no per-request DB/R2 reads.
 * All records are projected from build-time, public-only verified snapshots.
 */
import { buildSitemapEntries, publishedSitemapRows, serializeSitemap } from "../lib/sitemap.ts";
import { siteOrigin } from "../lib/pageHead.ts";
import { getEventBuildData } from "../lib/eventData.ts";
import { loadUserBuildData } from "../lib/userData.ts";
import { FIXTURE_VIDEO_DETAIL_PAYLOADS } from "../lib/videoFixtures.ts";
import { loadVideoPagesForBuild, type VideoPage } from "../lib/videoPage.ts";
import { normalizeStaticVideoDetail } from "../../../../src/lib/publicData/staticVideoDetailCore.ts";
import { snapshotAccessFromEnv, type SnapshotAccess } from "../lib/snapshotEnv.ts";
import {
  loadSitemapVideosSnapshot,
  loadUsersIndexSnapshot,
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
 * emitted static page set, never the index alias alone, for sitemap links.
 * Reads occur during the Astro build, not as request-time R2 lookups.
 */
export function sitemapRowsForEmittedVideoPages(
  rows: readonly SitemapVideoRow[],
  pages: readonly Pick<VideoPage, "videoId" | "canonicalSlug" | "slug" | "youtubeId">[],
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
  const [videos, events, users, videoPages] = await Promise.all([
    sitemapVideosOrEmpty(access),
    getEventBuildData(),
    loadUserBuildData(),
    loadVideoPagesForBuild(),
  ]);
  let userGeneratedAt: number | null = null;
  if (access && users.index) {
    const index = await loadUsersIndexSnapshot(access.source, access.options);
    const value = Number(index.generated_at);
    if (Number.isFinite(value) && value > 0) userGeneratedAt = value;
  }
  // A public index row is not evidence that its canonical detail URL was emitted.
  // Match the exact set of Astro-generated pages, not just manifest key names.
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
