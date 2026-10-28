/**
 * MIG-0621 U03 — sitemap entries and Next 15 metadata-compatible serialization.
 * Public-only inputs come from verified build snapshots, never request-time D1.
 */
import type { SitemapVideoRow } from "./publicDataLoader.ts";

export type SitemapFrequency = "daily" | "weekly" | "monthly";
export interface SitemapEntry {
  url: string;
  lastModified: Date;
  changeFrequency: SitemapFrequency;
  priority: number;
}

export interface SitemapEvent {
  id: string;
  start_time: number | null;
  end_time: number | null;
}
export interface SitemapCreator {
  x_id: string;
  updated_at: number | null;
}

function validDate(unix: number | null | undefined): Date | null {
  if (typeof unix !== "number" || !Number.isFinite(unix) || unix <= 0) return null;
  const date = new Date(unix * 1000);
  return Number.isFinite(date.valueOf()) ? date : null;
}

/** One immutable fallback per build rather than calling new Date() for every URL. */
export function buildSitemapEntries(input: {
  origin: string;
  videos: readonly SitemapVideoRow[];
  events: readonly SitemapEvent[];
  creators: readonly SitemapCreator[];
  generatedAt?: readonly (number | null | undefined)[];
  now?: Date;
}): SitemapEntry[] {
  const { origin } = input;
  const now = input.now ?? new Date();
  const generated = Math.max(0, ...(input.generatedAt ?? []).filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0,
  ));
  const fallback = validDate(generated) ?? now;
  const entry = (path: string, changeFrequency: SitemapFrequency, priority: number, unix?: number | null): SitemapEntry => ({
    url: new URL(path, origin).toString(),
    lastModified: validDate(unix) ?? fallback,
    changeFrequency,
    priority,
  });
  const candidates: SitemapEntry[] = [
    entry("/", "daily", 1),
    entry("/recommend", "daily", 0.8),
    entry("/list", "daily", 0.8),
    entry("/event", "daily", 0.7),
    entry("/user", "weekly", 0.6),
    entry("/about", "monthly", 0.4),
    entry("/rules", "monthly", 0.3),
    ...input.videos.map((v) => entry(`/${encodeURIComponent(v.youtube_video_id ?? v.id)}`, "weekly", 0.7, v.scheduled_time)),
    ...input.events.map((e) => entry(`/event/${encodeURIComponent(e.id)}`, "weekly", 0.7, e.end_time ?? e.start_time)),
    ...input.creators.map((u) => entry(`/user/${encodeURIComponent(u.x_id)}`, "weekly", 0.6, u.updated_at)),
  ];
  // A repeated YouTube alias / duplicated creator can otherwise publish the same
  // canonical URL twice. URL() also collapses "." / ".." aliases into the root.
  // Keep the first entry in CURRENT order (static, videos, events, creators).
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.url)) return false;
    seen.add(candidate.url);
    return true;
  });
}

/** Do not advertise URLs for entries whose static detail page was not published. */
export function publishedSitemapRows<T extends { id: string }>(
  rows: readonly T[],
  publishedIds: ReadonlySet<string>,
): T[] {
  return rows.filter((row) => publishedIds.has(row.id));
}

/** Replicates Next 15.5 resolveSitemap for our loc/lastmod/changefreq/priority-only entries. */
export function serializeSitemap(entries: readonly SitemapEntry[]): string {
  let result = '<?xml version="1.0" encoding="UTF-8"?>\n';
  result += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  for (const item of entries) {
    result += '<url>\n';
    result += `<loc>${item.url}</loc>\n`;
    result += `<lastmod>${item.lastModified.toISOString()}</lastmod>\n`;
    result += `<changefreq>${item.changeFrequency}</changefreq>\n`;
    result += `<priority>${item.priority}</priority>\n`;
    result += '</url>\n';
  }
  result += '</urlset>\n';
  return result;
}
