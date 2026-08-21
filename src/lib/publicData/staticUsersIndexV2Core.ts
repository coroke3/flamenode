import {
  normalizeCount,
  normalizeNumericUnix as normalizeUnix,
  normalizePresentString as normalizeString,
} from "./normalize.ts";

export const USERS_INDEX_V2_SCHEMA_VERSION = 2 as const;
export const USERS_INDEX_V2_PAGE_SIZE = 48;
export const USERS_INDEX_V2_MANIFEST_OBJECT_KEY =
  "users/index.v2/manifest.json";
export const USERS_INDEX_V2_GENERATION_PREFIX = "users/index.v2/g";
export const USERS_INDEX_V2_MAX_PAGE_BYTES = 256 * 1024;
export const USERS_SEARCH_LITE_V1_MAX_BYTES = 2 * 1024 * 1024;
export const USERS_INDEX_V2_MAX_MANIFEST_BYTES = 64 * 1024;

export type UsersIndexV2Sort = "score" | "works" | "name";
export const USERS_INDEX_V2_SORTS: readonly UsersIndexV2Sort[] = [
  "score",
  "works",
  "name",
] as const;

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
  sorts: UsersIndexV2Sort[];
};

export type UsersIndexV2Page = {
  schema_version: 2;
  generation: string;
  generated_at: number;
  sort: UsersIndexV2Sort;
  page: number;
  page_size: number;
  total: number;
  items: UsersIndexV2Entry[];
};

/** Backward-compatible type name for the original score-only rollout. */
export type UsersIndexV2ScorePage = UsersIndexV2Page;

export type UsersSearchLiteV1 = {
  schema_version: 1;
  generation: string;
  generated_at: number;
  total: number;
  items: UsersIndexV2Entry[];
};

export type UsersIndexV2Artifacts = {
  manifest: UsersIndexV2Manifest;
  scorePages: UsersIndexV2Page[];
  worksPages: UsersIndexV2Page[];
  namePages: UsersIndexV2Page[];
  searchLite: UsersSearchLiteV1;
};

function safeGenerationForObjectKey(generation: string): string {
  const normalized = generation.trim();
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(normalized)) {
    throw new Error("invalid users index v2 generation");
  }
  return normalized;
}

function isUsersIndexV2Sort(value: unknown): value is UsersIndexV2Sort {
  return value === "score" || value === "works" || value === "name";
}

export function usersIndexV2PageObjectKey(
  generation: string,
  sort: UsersIndexV2Sort,
  page: number,
): string {
  if (!isUsersIndexV2Sort(sort)) {
    throw new Error("invalid users index v2 sort");
  }
  const parsedPage = Number(page);
  const safePage = Number.isFinite(parsedPage)
    ? Math.max(1, Math.floor(parsedPage))
    : 1;
  return `${USERS_INDEX_V2_GENERATION_PREFIX}/${safeGenerationForObjectKey(generation)}/${sort}/${safePage}.json`;
}

export function usersIndexV2ScorePageObjectKey(
  generation: string,
  page: number,
): string {
  return usersIndexV2PageObjectKey(generation, "score", page);
}

export function usersIndexV2SearchLiteObjectKey(generation: string): string {
  return `${USERS_INDEX_V2_GENERATION_PREFIX}/${safeGenerationForObjectKey(generation)}/search-lite.v1.json`;
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

export function sortUsersIndexV2Entries(
  items: readonly UsersIndexV2Entry[],
  sort: UsersIndexV2Sort,
): UsersIndexV2Entry[] {
  if (sort === "score") return [...items];
  const sorted = [...items];
  sorted.sort((a, b) => {
    if (sort === "name") {
      return a.x_name.localeCompare(b.x_name, "ja");
    }
    return (
      b.total_works - a.total_works ||
      a.x_name.localeCompare(b.x_name, "ja")
    );
  });
  return sorted;
}

function paginateSortedEntries(args: {
  items: readonly UsersIndexV2Entry[];
  sort: UsersIndexV2Sort;
  pageSize: number;
  generatedAt: number;
  generation: string;
  total: number;
  totalPages: number;
}): UsersIndexV2Page[] {
  const pages: UsersIndexV2Page[] = [];
  for (let page = 1; page <= args.totalPages; page += 1) {
    const start = (page - 1) * args.pageSize;
    pages.push({
      schema_version: USERS_INDEX_V2_SCHEMA_VERSION,
      generation: args.generation,
      generated_at: args.generatedAt,
      sort: args.sort,
      page,
      page_size: args.pageSize,
      total: args.total,
      items: args.items.slice(start, start + args.pageSize),
    });
  }
  return pages;
}

/**
 * buildPublicUsersIndexItems() が保証する score DESC → 日本語名順をscore正本として使い、
 * works/nameも生成時に一度だけ並べ替えてpage shard化する。
 */
export function buildUsersIndexV2Artifacts(args: {
  items: readonly UsersIndexV2SourceEntry[];
  generatedAt: number;
  generation: string;
  pageSize?: number;
}): UsersIndexV2Artifacts {
  const parsedPageSize = Number(args.pageSize ?? USERS_INDEX_V2_PAGE_SIZE);
  const pageSize = Number.isFinite(parsedPageSize)
    ? Math.max(1, Math.floor(parsedPageSize))
    : USERS_INDEX_V2_PAGE_SIZE;
  const compact = args.items.map(compactEntry);
  const total = compact.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const score = sortUsersIndexV2Entries(compact, "score");
  const works = sortUsersIndexV2Entries(compact, "works");
  const name = sortUsersIndexV2Entries(compact, "name");

  return {
    manifest: {
      schema_version: USERS_INDEX_V2_SCHEMA_VERSION,
      generation: args.generation,
      generated_at: args.generatedAt,
      total,
      page_size: pageSize,
      total_pages: totalPages,
      sorts: [...USERS_INDEX_V2_SORTS],
    },
    scorePages: paginateSortedEntries({
      items: score,
      sort: "score",
      pageSize,
      generatedAt: args.generatedAt,
      generation: args.generation,
      total,
      totalPages,
    }),
    worksPages: paginateSortedEntries({
      items: works,
      sort: "works",
      pageSize,
      generatedAt: args.generatedAt,
      generation: args.generation,
      total,
      totalPages,
    }),
    namePages: paginateSortedEntries({
      items: name,
      sort: "name",
      pageSize,
      generatedAt: args.generatedAt,
      generation: args.generation,
      total,
      totalPages,
    }),
    searchLite: {
      schema_version: 1,
      generation: args.generation,
      generated_at: args.generatedAt,
      total,
      items: score,
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
  return generation && /^[A-Za-z0-9._-]{1,128}$/.test(generation)
    ? generation
    : null;
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
  if (
    !generation ||
    generatedAt == null ||
    total == null ||
    !pageSize ||
    !totalPages ||
    !Array.isArray(row.sorts)
  ) {
    return null;
  }
  const sorts = row.sorts.filter(isUsersIndexV2Sort);
  if (
    sorts.length !== USERS_INDEX_V2_SORTS.length ||
    !USERS_INDEX_V2_SORTS.every((sort) => sorts.includes(sort))
  ) {
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
    sorts: [...USERS_INDEX_V2_SORTS],
  };
}

export function normalizeUsersIndexV2Page(
  value: unknown,
): UsersIndexV2Page | null {
  const row = asRecord(value);
  if (!row || Number(row.schema_version) !== USERS_INDEX_V2_SCHEMA_VERSION) return null;
  const generation = normalizeGeneration(row.generation);
  const generatedAt = normalizeUnix(row.generated_at);
  const sort = isUsersIndexV2Sort(row.sort) ? row.sort : null;
  const page = normalizePositiveInt(row.page);
  const pageSize = normalizePositiveInt(row.page_size);
  const total = normalizeNonNegativeInt(row.total);
  if (
    !generation ||
    generatedAt == null ||
    !sort ||
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
    sort,
    page,
    page_size: pageSize,
    total,
    items,
  };
}

export function normalizeUsersIndexV2ScorePage(
  value: unknown,
): UsersIndexV2Page | null {
  const page = normalizeUsersIndexV2Page(value);
  return page?.sort === "score" ? page : null;
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

export function prepareUsersSearchLiteItems(
  items: readonly UsersIndexV2Entry[],
  query: string,
  sort: UsersIndexV2Sort,
): UsersIndexV2Entry[] {
  const filtered = filterUsersSearchLiteByQuery(items, query);
  return sortUsersIndexV2Entries(filtered, sort);
}

export function usersIndexV2ArtifactByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
