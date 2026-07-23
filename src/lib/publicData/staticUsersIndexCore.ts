import {
  normalizeCount,
  normalizeNumericUnix as normalizeUnix,
  normalizePresentString as normalizeNullableString,
  normalizePresentString as normalizeString,
} from "./normalize.ts";

export interface StaticUsersIndexPayload {
  generated_at?: unknown;
  items?: unknown;
}

export interface StaticUsersIndexEntry {
  x_id: string;
  x_name: string;
  icon_url: string | null;
  profile_text: string | null;
  youtube_channel_url: string | null;
  personal_count: number;
  collab_count: number;
  total_works: number;
  sort_score: number;
  updated_at: number | null;
}

export interface StaticUsersIndex {
  generatedAt: number | null;
  items: StaticUsersIndexEntry[];
}

export type UsersIndexSort = "score" | "name" | "works";

export function normalizeStaticUsersIndex(
  payload: StaticUsersIndexPayload,
): StaticUsersIndex | null {
  if (!Array.isArray(payload.items)) return null;
  const items = payload.items
    .map(normalizeEntry)
    .filter((entry): entry is StaticUsersIndexEntry => entry !== null);
  if (items.length === 0) return null;
  return {
    generatedAt: normalizeUnix(payload.generated_at),
    items,
  };
}

export function filterUsersIndexItems(
  items: readonly StaticUsersIndexEntry[],
  query: string,
): StaticUsersIndexEntry[] {
  const keyword = query.trim().toLocaleLowerCase();
  if (!keyword) return [...items];
  return items.filter(
    (entry) =>
      entry.x_name.toLocaleLowerCase().includes(keyword) ||
      entry.x_id.toLocaleLowerCase().includes(keyword),
  );
}

export function sortUsersIndexItems(
  items: readonly StaticUsersIndexEntry[],
  sort: UsersIndexSort,
): StaticUsersIndexEntry[] {
  const sorted = [...items];
  sorted.sort((a, b) => {
    if (sort === "name") {
      return a.x_name.localeCompare(b.x_name, "ja");
    }
    if (sort === "works") {
      return (
        b.total_works - a.total_works ||
        a.x_name.localeCompare(b.x_name, "ja")
      );
    }
    return (
      b.sort_score - a.sort_score ||
      a.x_name.localeCompare(b.x_name, "ja")
    );
  });
  return sorted;
}

export function paginateUsersIndexItems<T>(
  items: readonly T[],
  page: number,
  pageSize: number,
): { total: number; totalPages: number; safePage: number; current: T[] } {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    total,
    totalPages,
    safePage,
    current: items.slice(start, start + pageSize),
  };
}

function normalizeEntry(value: unknown): StaticUsersIndexEntry | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const xId =
    normalizeString(row.x_id) ?? normalizeString(row.id);
  const xName = normalizeString(row.x_name);
  if (!xId || !xName) return null;
  const personalCount =
    normalizeCount(row.personal_count ?? row.own_count) ?? 0;
  const collabCount = normalizeCount(row.collab_count) ?? 0;
  const totalWorks =
    normalizeCount(row.total_works ?? row.total_count) ??
    personalCount + collabCount;
  const sortScore =
    normalizeCount(row.sort_score) ?? totalWorks * 2 + personalCount;
  return {
    x_id: xId,
    x_name: xName,
    icon_url: normalizeNullableString(row.icon_url),
    profile_text: normalizeNullableString(row.profile_text),
    youtube_channel_url: normalizeNullableString(row.youtube_channel_url),
    personal_count: personalCount,
    collab_count: collabCount,
    total_works: totalWorks,
    sort_score: sortScore,
    updated_at: normalizeUnix(row.updated_at),
  };
}
