/**
 * MIG-0621 U03 — static Astro sitemap; no per-request DB/R2 reads.
 * All records are projected from build-time, public-only verified snapshots.
 */
import { buildSitemapEntries, publishedSitemapRows, serializeSitemap } from "../lib/sitemap.ts";
import { siteOrigin } from "../lib/pageHead.ts";
import { getEventBuildData } from "../lib/eventData.ts";
import { loadUserBuildData } from "../lib/userData.ts";
import { loadVideoPagesForBuild } from "../lib/videoPage.ts";
import { FIXTURE_VIDEO_DETAIL_PAYLOADS } from "../lib/videoFixtures.ts";
import { normalizeStaticVideoDetail } from "../../../../src/lib/publicData/staticVideoDetailCore.ts";
import { snapshotAccessFromEnv, type SnapshotAccess } from "../lib/snapshotEnv.ts";
import {
  loadSitemapVideosSnapshot,
  loadUsersIndexSnapshot,
  SnapshotBuildError,
  SITEMAP_VIDEOS_KEY,
  videoDetailKeys,
  type SitemapVideoSnapshot,
} from "../lib/publicDataLoader.ts";

const EMPTY_VIDEOS: SitemapVideoSnapshot = { generated_at: null, videos: [] };

export async function sitemapVideosOrEmpty(
  access: SnapshotAccess | null,
  warn: (message: string) => void = console.warn,
): Promise<SitemapVideoSnapshot> {
  if (!access) {
    // Astro still publishes the local public video fixtures in this build mode.
    // Derive only canonical pages from the same emitter used by /[id].astro.
    const canonicalPages = (await loadVideoPagesForBuild({}))
      .filter((page) => page.slug === page.canonicalSlug);
    warn("[sitemap] no build snapshot configured; using published video fixtures");
    return {
      generated_at: null,
      videos: canonicalPages.map((page) => {
        const raw = FIXTURE_VIDEO_DETAIL_PAYLOADS[page.videoId];
        const detail = raw ? normalizeStaticVideoDetail(raw as Parameters<typeof normalizeStaticVideoDetail>[0]) : null;
        const scheduled = detail?.video.scheduled_time ?? null;
        return {
          id: page.videoId,
          youtube_video_id: page.youtubeId ? page.canonicalSlug : null,
          scheduled_time: scheduled,
        };
      }),
    };
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

export async function GET(): Promise<Response> {
  const access = snapshotAccessFromEnv();
  const [videos, events, users] = await Promise.all([
    sitemapVideosOrEmpty(access),
    getEventBuildData(),
    loadUserBuildData(),
  ]);
  let userGeneratedAt: number | null = null;
  if (access && users.index) {
    const index = await loadUsersIndexSnapshot(access.source, access.options);
    const value = Number(index.generated_at);
    if (Number.isFinite(value) && value > 0) userGeneratedAt = value;
  }
  // The recent index may contain a public row without a static detail asset.
  // Match the same manifest / detail map that Astro uses to emit the pages.
  const manifest = access?.options.manifest;
  if (access && !manifest) {
    throw new Error("[sitemap] configured snapshot manifest is missing");
  }
  const publishedVideoIds = manifest
    ? new Set(videoDetailKeys(manifest).map((key) => key.slice("snapshot/video-detail/".length, -".json".length)))
    : new Set(videos.videos.map((video) => video.id)); // no snapshot: verified fixture page emitter
  const publishedEventIds = new Set(events.details.keys());
  const entries = buildSitemapEntries({
    origin: siteOrigin(),
    videos: publishedSitemapRows(videos.videos, publishedVideoIds),
    events: publishedSitemapRows(events.index?.events ?? [], publishedEventIds),
    creators: users.index ?? [],
    generatedAt: [videos.generated_at, events.index?.generatedAt, userGeneratedAt],
  });
  return new Response(serializeSitemap(entries), {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
