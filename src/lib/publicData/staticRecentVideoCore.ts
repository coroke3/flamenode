export interface StaticRecentVideoRow {
  id?: unknown;
  title?: unknown;
  youtube_video_id?: unknown;
  display_name?: unknown;
  creator_display_name?: unknown;
  icon_url?: unknown;
  creator_icon_url?: unknown;
  primary_event_id?: unknown;
  primary_event_title?: unknown;
  scheduled_time?: unknown;
  status?: unknown;
}

export interface StaticRecentVideosPayload {
  generated_at?: unknown;
  total?: unknown;
  items?: unknown;
}

export interface StaticRecentVideo {
  id: string;
  title: string;
  youtube_video_id: string | null;
  display_name: string;
  icon_url: string | null;
  primary_event_id: string | null;
  primary_event_title: string | null;
  scheduled_time: number | null;
  status: "public";
  part: null;
}

export interface StaticRecentVideoPage {
  videos: StaticRecentVideo[];
  total: number;
  generatedAt: number | null;
}

export function normalizeStaticRecentVideoPage(
  payload: StaticRecentVideosPayload,
  page: number,
  pageSize: number,
): StaticRecentVideoPage | null {
  if (!Array.isArray(payload.items)) return null;
  const normalized = payload.items
    .map(normalizeStaticRecentVideoRow)
    .filter((row): row is StaticRecentVideo => row !== null);
  const total = normalizeCount(payload.total) ?? normalized.length;
  const pageNum = Math.max(1, Math.floor(page));
  const size = Math.max(1, Math.floor(pageSize));
  const offset = (pageNum - 1) * size;
  if (offset >= normalized.length && total > normalized.length) {
    return null;
  }
  return {
    videos: normalized.slice(offset, offset + size),
    total,
    generatedAt: normalizeUnix(payload.generated_at),
  };
}

function normalizeStaticRecentVideoRow(
  value: unknown,
): StaticRecentVideo | null {
  if (!value || typeof value !== "object") return null;
  const row = value as StaticRecentVideoRow;
  const id = normalizeString(row.id);
  const title = normalizeString(row.title);
  if (!id || !title) return null;
  return {
    id,
    title,
    youtube_video_id: normalizeNullableString(row.youtube_video_id),
    display_name:
      normalizeString(row.display_name) ??
      normalizeString(row.creator_display_name) ??
      "unknown",
    icon_url:
      normalizeNullableString(row.icon_url) ??
      normalizeNullableString(row.creator_icon_url),
    primary_event_id: normalizeNullableString(row.primary_event_id),
    primary_event_title: normalizeNullableString(row.primary_event_title),
    scheduled_time: normalizeUnix(row.scheduled_time),
    status: "public",
    part: null,
  };
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeCount(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

function normalizeUnix(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.floor(n);
}
