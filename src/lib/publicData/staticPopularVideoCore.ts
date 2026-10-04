import {
  normalizeCount,
  normalizeNumericUnix as normalizeUnix,
  normalizePresentString as normalizeNullableString,
} from "./normalize.ts";
import { normalizeStaticVideoCardBase } from "./staticVideoCardCore.ts";
import type { StaticRecentVideo, StaticRecentVideoPage } from "./staticRecentVideoCore";

export interface StaticPopularVideosPayload {
  generated_at?: unknown;
  total?: unknown;
  items?: unknown;
}

export function normalizeStaticPopularVideoPage(
  payload: StaticPopularVideosPayload,
  page: number,
  pageSize: number,
): StaticRecentVideoPage | null {
  if (!Array.isArray(payload.items)) return null;
  const normalized = payload.items
    .map(normalizeStaticPopularVideoRow)
    .filter((row): row is StaticRecentVideo => row !== null);
  const rawTotal = normalizeCount(payload.total) ?? normalized.length;
  const total = Math.min(rawTotal, normalized.length);
  const pageNum = Math.max(1, Math.floor(page));
  const size = Math.max(1, Math.floor(pageSize));
  const offset = (pageNum - 1) * size;
  return {
    videos: normalized.slice(offset, offset + size),
    total,
    generatedAt: normalizeUnix(payload.generated_at),
  };
}

function normalizeStaticPopularVideoRow(value: unknown): StaticRecentVideo | null {
  const base = normalizeStaticVideoCardBase(value);
  if (!base) return null;
  const row = value as Record<string, unknown>;
  return {
    ...base,
    primary_event_title: normalizeNullableString(row.primary_event_title),
    status: "public",
    part: null,
  };
}
