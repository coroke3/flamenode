import {
  normalizeCount,
  normalizeNumericUnix as normalizeUnix,
  normalizePresentString as normalizeString,
} from "./normalize.ts";

export const USERS_INDEX_V2_SCHEMA_VERSION = 2 as const;
export const USERS_INDEX_V2_PAGE_SIZE = 48;
export const USERS_INDEX_V2_MANIFEST_OBJECT_KEY =
  "users/index.v2/manifest.json";
export const USERS_INDEX_V2_SCORE_PREFIX = "users/index.v2/score";
export const USERS_SEARCH_LITE_V1_OBJECT_KEY = "users/search-lite.v1.json";
export const USERS_INDEX_V2_MAX_PAGE_BYTES = 256 * 1024;
export const USERS_SEARCH_LITE_V1_MAX_BYTES = 2 * 1024 * 1024;
export const USERS_INDEX_V2_MAX_MANIFEST_BYTES = 64 * 1024;

export type UsersIndexV2SourceEntry = {
  x_id: string;
  x_name: string;
  icon_url: string | null;
  personal_count: number;
  collab_count: number;
  total_works: number;
  sort_score: number;
};

export type UsersIndexV2Entry = UsersIndexV2SourceEntry;

export type UsersIndexV2Manifest = {
  schema_version: 2;
  generation: string;
  generated_at: number;
  total: number;
  page_size: number;
  total_pages: number;
};

export type UsersIndexV2ScorePage = {
  schema_version: 2;
  generation: string;
  generated_at: number;
  page: number;
  page_size: number;
  total: number;
  items: UsersIndexV2Entry[];
};

export type UsersSearchLiteV1 = {
  schema_version: 1;
  generation: string;
  generated_at: number;
  total: number;
  items: UsersIndexV2Entry[];
};

export type UsersIndexV2Artifacts = {
  manifest: UsersIndexV2Manifest;
  scorePages: UsersIndexV2ScorePage[];
  searchLite: UsersSearchLiteV1;
};

export function usersIndexV2ScorePageObjectKey(page: number): string {
  const safePage = Math.max(1, Math.floor(page));
  return `${USERS_INDEX_V2_SCORE_PREFIX}/${safePage}.json`;
}

function compactEntry(entry: UsersIndexV2SourceEntry): UsersIndexV2Entry {
  return {
    x_id: entry.x_id,
    x_name: entry.x_name,
    icon_url: entry.icon_url,
    personal_count: entry.personal_count,
    collab_count: entry.collab_count,
    total_works: entry.total_works,
    sort_score: entry.sort_score,
  };
}

/**
 * buildPublicUsersIndexItems() が保証する score DESC → 日本語名順をそのまま分割する。
 * request-time sort を発生させないため、この関数内では並び替えない。
 */
export function buildUsersIndexV2Artifacts(args: {
  items: readonly UsersIndexV2SourceEntry[];
  generatedAt: number;
  generation: string;
  pageSize?: number;
}): UsersIndexV2Artifacts {
  const pageSize = Math.max(1, Math.floor(args.pageSize ?? USERS_INDEX_V2_PAGE_SIZE));
  const compact = args.items.map(compactEntry);
  const total = compact.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const scorePages: UsersIndexV2ScorePage[] = [];

  for (let page = 1; page <= totalPages; page += 1) {
    const start = (page - 1) * pageSize;
    scorePages.push({
      schema_version: USERS_INDEX_V2_SCHEMA_VERSION,
      generation: args.generation,
      generated_at: args.generatedAt,
      page,
      page_size: pageSize,
      total,
      items: compact.slice(start, start + pageSize),
    });
  }

  return {
    manifest: {
      schema_version: USERS_INDEX_V2_SCHEMA_VERSION,
      generation: args.generation,
      generated_at: args.generatedAt,
      total,
      page_size: pageSize,
      total_pages: totalPages,
    },
    scorePages,
    searchLite: {
      schema_version: 1,
      generation: args.generation,
      generated_at: args.generatedAt,
      total,
      items: compact,
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeGeneration(value: unknown): string | null {
  const generation = normalizeString(value);
  return generation && generation.length <= 128 ? generation : null;
}

function normalizePositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return Math.floor(parsed);
}

function normalizeNonNegativeInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

function normalizeEntry(value: unknown): UsersIndexV2Entry | null {
  const row = asRecord(value);
  if (!row) return null;
  const xId = normalizeString(row.x_id);
  const xName = normalizeString(row.x_name);
  if (!xId || !xName) return null;
  const personalCount = normalizeCount(row.personal_count) ?? 0;
  const collabCount = normalizeCount(row.collab_count) ?? 0;
  const totalWorks = normalizeCount(row.total_works) ?? personalCount + collabCount;
  const sortScore = normalizeCount(row.sort_score) ?? totalWorks * 2 + personalCount;
  const icon = row.icon_url == null ? null : normalizeString(row.icon_url);
  return {
    x_id: xId,
    x_name: xName,
    icon_url: icon,
    personal_count: personalCount,
    collab_count: collabCount,
    total_works: totalWorks,
    sort_score: sortScore,
  };
}

export function normalizeUsersIndexV2Manifest(
  value: unknown,
): UsersIndexV2Manifest | null {
  const row = asRecord(value);
  if (!row || Number(row.schema_version) !== USERS_INDEX_V2_SCHEMA_VERSION) return null;
  const generation = normalizeGeneration(row.generation);
  const generatedAt = normalizeUnix(row.generated_at);
  const total = normalizeNonNegativeInt(row.total);
  const pageSize = normalizePositiveInt(row.page_size);
  const totalPages = normalizePositiveInt(row.total_pages);
  if (!generation || generatedAt == null || total == null || !pageSize || !totalPages) {
    return null;
  }
  if (totalPages !== Math.max(1, Math.ceil(total / pageSize))) return null;
  return {
    schema_version: USERS_INDEX_V2_SCHEMA_VERSION,
    generation,
    generated_at: generatedAt,
    total,
    page_size: pageSize,
    total_pages: totalPages,
  };
}

export function normalizeUsersIndexV2ScorePage(
  value: unknown,
): UsersIndexV2ScorePage | null {
  const row = asRecord(value);
  if (!row || Number(row.schema_version) !== USERS_INDEX_V2_SCHEMA_VERSION) return null;
  const generation = normalizeGeneration(row.generation);
  const generatedAt = normalizeUnix(row.generated_at);
  const page = normalizePositiveInt(row.page);
  const pageSize = normalizePositiveInt(row.page_size);
  const total = normalizeNonNegativeInt(row.total);
  if (
    !generation ||
    generatedAt == null ||
    !page ||
    !pageSize ||
    total == null ||
    !Array.isArray(row.items)
  ) {
    return null;
  }
  const items: UsersIndexV2Entry[] = [];
  for (const item of row.items) {
    const normalized = normalizeEntry(item);
    if (!normalized) return null;
    items.push(normalized);
  }
  if (items.length > pageSize) return null;
  return {
    schema_version: USERS_INDEX_V2_SCHEMA_VERSION,
    generation,
    generated_at: generatedAt,
    page,
    page_size: pageSize,
    total,
    items,
  };
}

export function normalizeUsersSearchLiteV1(
  value: unknown,
): UsersSearchLiteV1 | null {
  const row = asRecord(value);
  if (!row || Number(row.schema_version) !== 1) return null;
  const generation = normalizeGeneration(row.generation);
  const generatedAt = normalizeUnix(row.generated_at);
  const total = normalizeNonNegativeInt(row.total);
  if (!generation || generatedAt == null || total == null || !Array.isArray(row.items)) {
    return null;
  }
  const items: UsersIndexV2Entry[] = [];
  for (const item of row.items) {
    const normalized = normalizeEntry(item);
    if (!normalized) return null;
    items.push(normalized);
  }
  if (items.length !== total) return null;
  return {
    schema_version: 1,
    generation,
    generated_at: generatedAt,
    total,
    items,
  };
}

export function filterUsersSearchLiteByQuery(
  items: readonly UsersIndexV2Entry[],
  query: string,
): UsersIndexV2Entry[] {
  const keyword = query.trim().toLocaleLowerCase();
  if (!keyword) return [...items];
  return items.filter(
    (entry) =>
      entry.x_name.toLocaleLowerCase().includes(keyword) ||
      entry.x_id.toLocaleLowerCase().includes(keyword),
  );
}

export function usersIndexV2ArtifactByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
