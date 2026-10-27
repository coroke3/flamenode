/**
 * MIG-0621 U03 — static Astro sitemap; no per-request DB/R2 reads.
 * All records are projected from build-time, public-only verified snapshots.
 */
import { buildSitemapEntries, serializeSitemap } from "../lib/sitemap.ts";
import { siteOrigin } from "../lib/pageHead.ts";
import { getEventBuildData } from "../lib/eventData.ts";
import { loadUserBuildData } from "../lib/userData.ts";
import { snapshotAccessFromEnv, type SnapshotAccess } from "../lib/snapshotEnv.ts";
import {
  loadSitemapVideosSnapshot,
  loadUsersIndexSnapshot,
  SnapshotBuildError,
  SITEMAP_VIDEOS_KEY,
  type SitemapVideoSnapshot,
} from "../lib/publicDataLoader.ts";

const EMPTY_VIDEOS: SitemapVideoSnapshot = { generated_at: null, videos: [] };

export async function sitemapVideosOrEmpty(
  access: SnapshotAccess | null,
  warn: (message: string) => void = console.warn,
): Promise<SitemapVideoSnapshot> {
  if (!access) {
    warn("[sitemap] no build snapshot configured; video URLs omitted");
    return EMPTY_VIDEOS;
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
  const entries = buildSitemapEntries({
    origin: siteOrigin(),
    videos: videos.videos,
    events: events.index?.events ?? [],
    creators: users.index ?? [],
    generatedAt: [videos.generated_at, events.index?.generatedAt, userGeneratedAt],
  });
  return new Response(serializeSitemap(entries), {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
