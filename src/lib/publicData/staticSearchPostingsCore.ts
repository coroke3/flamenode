import { normalizePresentString as normalizeString } from "./normalize.ts";

/**
 * Search postings are deliberately small, immutable R2 objects.  A request
 * reads the directory for the selected gram and only the posting pages that
 * contain that gram; it never parses the complete search corpus.
 */
export const STATIC_SEARCH_POSTINGS_SCHEMA_VERSION = 1 as const;
export const STATIC_SEARCH_POSTINGS_BUCKET_COUNT = 16;
export const STATIC_SEARCH_POSTINGS_MAX_PAGE_ITEMS = 256;
export const STATIC_SEARCH_POSTINGS_MAX_GRAM_LENGTH = 3;
export const STATIC_SEARCH_POSTINGS_MAX_PAGES_PER_GRAM = 512;
export const STATIC_SEARCH_POSTINGS_MAX_QUERY_PAGES = 32;
export const STATIC_SEARCH_POSTINGS_MAX_TOTAL_ITEMS = 100_000;

export type StaticSearchPostingDirectoryEntry = {
  pages: number[];
  total: number;
};

export type StaticSearchPostingDirectory = {
  schema_version: 1;
  generation: string;
  bucket: number;
  grams: Record<string, StaticSearchPostingDirectoryEntry>;
};

export type StaticSearchPostingPage<T> = {
  schema_version: 1;
  generation: string;
  bucket: number;
  page: number;
  records: Array<{
    gram: string;
    part: number;
    total: number;
    items: T[];
  }>;
};

export type StaticSearchPostingManifest = {
  schema_version: 1;
  generation: string;
  generated_at: number;
  total: number;
  bucket_count: number;
  backend: "postings-v1";
  /** Buckets with at least one posting. Older manifests may omit this field. */
  buckets?: number[];
};

export type StaticSearchPostingArtifacts<T> = {
  manifest: StaticSearchPostingManifest;
  directories: Array<{
    bucket: number;
    directory: StaticSearchPostingDirectory;
  }>;
  pages: Array<{
    bucket: number;
    page: StaticSearchPostingPage<T>;
  }>;
};

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function staticSearchPostingBucket(gram: string): number {
  return stableHash(gram) % STATIC_SEARCH_POSTINGS_BUCKET_COUNT;
}

export function normalizeStaticSearchQuery(value: string): string {
  // Artifact generation and edge lookup must not depend on the host locale.
  return value.trim().toLowerCase();
}

/** Return the longest (up to 3-character) grams used for candidate lookup. */
export function staticSearchQueryGrams(query: string): string[] {
  const chars = [...normalizeStaticSearchQuery(query)];
  if (chars.length === 0) return [];
  const length = Math.min(STATIC_SEARCH_POSTINGS_MAX_GRAM_LENGTH, chars.length);
  const grams = new Set<string>();
  for (let index = 0; index + length <= chars.length; index += 1) {
    grams.add(chars.slice(index, index + length).join(""));
  }
  return [...grams];
}

function normalizeMinGramLength(value: number | undefined): number {
  if (value === undefined) return 1;
  if (!Number.isSafeInteger(value)) {
    throw new Error("invalid static search minimum gram length");
  }
  return Math.min(
    STATIC_SEARCH_POSTINGS_MAX_GRAM_LENGTH,
    Math.max(1, value),
  );
}

function gramsForText(value: string, minGramLength: number): string[] {
  const chars = [...normalizeStaticSearchQuery(value)];
  const grams = new Set<string>();
  for (
    let length = minGramLength;
    length <= STATIC_SEARCH_POSTINGS_MAX_GRAM_LENGTH;
    length += 1
  ) {
    for (let index = 0; index + length <= chars.length; index += 1) {
      const gram = chars.slice(index, index + length).join("");
      // Whitespace-only grams cannot be produced by a trimmed query and only
      // create unreachable posting shards. Keep internal/boundary whitespace
      // (for phrase queries), but omit these empty search tokens.
      if (/\S/u.test(gram)) grams.add(gram);
    }
  }
  return [...grams];
}

function safeGenerationForObjectKey(generation: string): string {
  const normalized = generation.trim();
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(normalized)) {
    throw new Error("invalid static search posting generation");
  }
  return normalized;
}

function safeBucketForObjectKey(bucket: number): number {
  if (
    !Number.isSafeInteger(bucket) ||
    bucket < 0 ||
    bucket >= STATIC_SEARCH_POSTINGS_BUCKET_COUNT
  ) {
    throw new Error("invalid static search posting bucket");
  }
  return bucket;
}

function safePageForObjectKey(page: number): number {
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new Error("invalid static search posting page");
  }
  return page;
}

function isCanonicalGram(value: string): boolean {
  // Posting grams are substrings of normalized source text. Unlike a complete
  // query they may legitimately begin/end with whitespace (e.g. "or "), so
  // validation must not trim them away. The builder emits lower-case grams;
  // keep the same invariant while rejecting empty/whitespace-only tokens.
  const normalized = value.toLowerCase();
  const length = [...value].length;
  return (
    value === normalized &&
    length >= 1 &&
    length <= STATIC_SEARCH_POSTINGS_MAX_GRAM_LENGTH &&
    /\S/u.test(value)
  );
}

export function buildStaticSearchPostingArtifacts<T>(args: {
  items: readonly T[];
  generatedAt: number;
  generation: string;
  textOf: (item: T) => readonly string[];
  keyOf: (item: T) => string;
  /** Default 1 for existing public search callers. */
  minGramLength?: number;
}): StaticSearchPostingArtifacts<T> {
  const generation = safeGenerationForObjectKey(args.generation);
  if (
    !Number.isSafeInteger(args.generatedAt) ||
    args.generatedAt < 0 ||
    args.items.length > STATIC_SEARCH_POSTINGS_MAX_TOTAL_ITEMS
  ) {
    throw new Error("invalid static search posting build input");
  }
  const minGramLength = normalizeMinGramLength(args.minGramLength);
  const byGram = new Map<string, Map<string, T>>();
  for (const item of args.items) {
    const key = normalizeString(args.keyOf(item));
    if (!key) continue;
    const grams = new Set(
      args.textOf(item).flatMap((value) => gramsForText(value, minGramLength)),
    );
    for (const gram of grams) {
      const entries = byGram.get(gram) ?? new Map<string, T>();
      entries.set(key, item);
      byGram.set(gram, entries);
    }
  }

  const bucketRecords = Array.from(
    { length: STATIC_SEARCH_POSTINGS_BUCKET_COUNT },
    () => [] as Array<StaticSearchPostingPage<T>["records"]>,
  );
  const directoryMaps = Array.from(
    { length: STATIC_SEARCH_POSTINGS_BUCKET_COUNT },
    () => new Map<string, StaticSearchPostingDirectoryEntry>(),
  );

  for (const gram of [...byGram.keys()].sort((a, b) => a.localeCompare(b))) {
    const bucket = staticSearchPostingBucket(gram);
    const values = [...(byGram.get(gram)?.values() ?? [])];
    const pages: number[] = [];
    const total = values.length;
    for (
      let offset = 0, part = 0;
      offset < values.length;
      offset += STATIC_SEARCH_POSTINGS_MAX_PAGE_ITEMS, part += 1
    ) {
      const pageRecords = bucketRecords[bucket];
      const items = values.slice(
        offset,
        offset + STATIC_SEARCH_POSTINGS_MAX_PAGE_ITEMS,
      );
      let currentPage = pageRecords.at(-1);
      const currentSize =
        currentPage?.reduce(
          (count, record) => count + record.items.length,
          0,
        ) ?? 0;
      if (
        !currentPage ||
        currentSize + items.length > STATIC_SEARCH_POSTINGS_MAX_PAGE_ITEMS
      ) {
        currentPage = [];
        pageRecords.push(currentPage);
      }
      currentPage.push({
        gram,
        part,
        total,
        items,
      });
      if (pages.at(-1) !== pageRecords.length) pages.push(pageRecords.length);
    }
    directoryMaps[bucket].set(gram, { pages, total });
  }

  const pages: StaticSearchPostingArtifacts<T>["pages"] = [];
  const directories: StaticSearchPostingArtifacts<T>["directories"] = [];
  for (
    let bucket = 0;
    bucket < STATIC_SEARCH_POSTINGS_BUCKET_COUNT;
    bucket += 1
  ) {
    const records = bucketRecords[bucket];
    if (records.length === 0) continue;
    for (let index = 0; index < records.length; index += 1) {
      const page = {
        schema_version: STATIC_SEARCH_POSTINGS_SCHEMA_VERSION,
        generation,
        bucket,
        page: index + 1,
        records: records[index],
      } satisfies StaticSearchPostingPage<T>;
      pages.push({ bucket, page });
    }
    const grams: Record<string, StaticSearchPostingDirectoryEntry> = {};
    for (const [gram, entry] of directoryMaps[bucket]) {
      grams[gram] = { pages: [...entry.pages], total: entry.total };
    }
    directories.push({
      bucket,
      directory: {
        schema_version: STATIC_SEARCH_POSTINGS_SCHEMA_VERSION,
        generation,
        bucket,
        grams,
      },
    });
  }

  return {
    manifest: {
      schema_version: STATIC_SEARCH_POSTINGS_SCHEMA_VERSION,
      generation,
      generated_at: args.generatedAt,
      total: args.items.length,
      bucket_count: STATIC_SEARCH_POSTINGS_BUCKET_COUNT,
      backend: "postings-v1",
      buckets: directories.map(({ bucket }) => bucket),
    },
    directories,
    pages,
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

export function normalizeStaticSearchPostingManifest(
  value: unknown,
): StaticSearchPostingManifest | null {
  const row = asRecord(value);
  if (
    !row ||
    row.schema_version !== STATIC_SEARCH_POSTINGS_SCHEMA_VERSION ||
    row.backend !== "postings-v1"
  )
    return null;
  const generation = normalizeGeneration(row.generation);
  const generatedAt = row.generated_at;
  const total = row.total;
  const bucketCount = row.bucket_count;
  if (
    !generation ||
    typeof generatedAt !== "number" ||
    !Number.isSafeInteger(generatedAt) ||
    generatedAt < 0 ||
    typeof total !== "number" ||
    !Number.isSafeInteger(total) ||
    total < 0 ||
    total > STATIC_SEARCH_POSTINGS_MAX_TOTAL_ITEMS ||
    bucketCount !== STATIC_SEARCH_POSTINGS_BUCKET_COUNT
  )
    return null;
  let buckets: number[] | undefined;
  if (row.buckets !== undefined) {
    if (!Array.isArray(row.buckets)) return null;
    buckets = [];
    const seen = new Set<number>();
    for (const rawBucket of row.buckets) {
      if (
        typeof rawBucket !== "number" ||
        !Number.isSafeInteger(rawBucket) ||
        rawBucket < 0 ||
        rawBucket >= STATIC_SEARCH_POSTINGS_BUCKET_COUNT ||
        seen.has(rawBucket)
      ) {
        return null;
      }
      seen.add(rawBucket);
      buckets.push(rawBucket);
    }
    buckets.sort((a, b) => a - b);
  }
  return {
    schema_version: STATIC_SEARCH_POSTINGS_SCHEMA_VERSION,
    generation,
    generated_at: generatedAt,
    total,
    bucket_count: STATIC_SEARCH_POSTINGS_BUCKET_COUNT,
    backend: "postings-v1",
    ...(buckets === undefined ? {} : { buckets }),
  };
}

export function normalizeStaticSearchPostingDirectory(
  value: unknown,
): StaticSearchPostingDirectory | null {
  const row = asRecord(value);
  if (!row || row.schema_version !== STATIC_SEARCH_POSTINGS_SCHEMA_VERSION) return null;
  const generation = normalizeGeneration(row.generation);
  const bucket = row.bucket;
  if (
    !generation ||
    typeof bucket !== "number" ||
    !Number.isSafeInteger(bucket) ||
    bucket < 0 ||
    bucket >= STATIC_SEARCH_POSTINGS_BUCKET_COUNT ||
    !row.grams ||
    typeof row.grams !== "object" ||
    Array.isArray(row.grams)
  )
    return null;
  const grams: Record<string, StaticSearchPostingDirectoryEntry> = {};
  for (const [gram, raw] of Object.entries(
    row.grams as Record<string, unknown>,
  )) {
    const entry = asRecord(raw);
    if (
      !entry ||
      !isCanonicalGram(gram) ||
      !Array.isArray(entry.pages) ||
      entry.pages.length > STATIC_SEARCH_POSTINGS_MAX_PAGES_PER_GRAM
    )
      return null;
    const pages: number[] = [];
    const seenPages = new Set<number>();
    for (const rawPage of entry.pages) {
      if (
        typeof rawPage !== "number" ||
        !Number.isSafeInteger(rawPage) ||
        rawPage < 1 ||
        seenPages.has(rawPage)
      ) {
        return null;
      }
      seenPages.add(rawPage);
      pages.push(rawPage);
    }
    const total = entry.total;
    if (
      typeof total !== "number" ||
      !Number.isSafeInteger(total) ||
      total < 0 ||
      total > STATIC_SEARCH_POSTINGS_MAX_TOTAL_ITEMS ||
      (total === 0) !== (pages.length === 0)
    )
      return null;
    grams[gram] = { pages, total };
  }
  return { schema_version: STATIC_SEARCH_POSTINGS_SCHEMA_VERSION, generation, bucket, grams };
}

export function normalizeStaticSearchPostingPage<T>(
  value: unknown,
  normalizeItem: (value: unknown) => T | null,
): StaticSearchPostingPage<T> | null {
  const row = asRecord(value);
  if (!row || row.schema_version !== STATIC_SEARCH_POSTINGS_SCHEMA_VERSION) return null;
  const generation = normalizeGeneration(row.generation);
  const bucket = row.bucket;
  const page = row.page;
  if (
    !generation ||
    typeof bucket !== "number" ||
    !Number.isSafeInteger(bucket) ||
    bucket < 0 ||
    bucket >= STATIC_SEARCH_POSTINGS_BUCKET_COUNT ||
    typeof page !== "number" ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Array.isArray(row.records)
  )
    return null;
  const records: StaticSearchPostingPage<T>["records"] = [];
  if (row.records.length > STATIC_SEARCH_POSTINGS_MAX_PAGE_ITEMS) return null;
  let pageItemCount = 0;
  const seenGrams = new Set<string>();
  for (const raw of row.records) {
    const record = asRecord(raw);
    if (
      !record ||
      typeof record.gram !== "string" ||
      !isCanonicalGram(record.gram) ||
      seenGrams.has(record.gram) ||
      !Array.isArray(record.items)
    )
      return null;
    seenGrams.add(record.gram);
    const items: T[] = [];
    for (const item of record.items) {
      const normalized = normalizeItem(item);
      if (normalized == null) return null;
      items.push(normalized);
    }
    const part = record.part;
    const total = record.total;
    pageItemCount += items.length;
    if (
      pageItemCount > STATIC_SEARCH_POSTINGS_MAX_PAGE_ITEMS ||
      typeof part !== "number" ||
      !Number.isSafeInteger(part) ||
      part < 0 ||
      typeof total !== "number" ||
      !Number.isSafeInteger(total) ||
      total < items.length ||
      total > STATIC_SEARCH_POSTINGS_MAX_TOTAL_ITEMS
    )
      return null;
    records.push({ gram: record.gram, part, total, items });
  }
  return { schema_version: STATIC_SEARCH_POSTINGS_SCHEMA_VERSION, generation, bucket, page, records };
}

export function staticSearchPostingManifestObjectKey(
  generation: string,
): string {
  return `search-postings.v1/${safeGenerationForObjectKey(generation)}/manifest.json`;
}

export function staticSearchPostingDirectoryObjectKey(
  generation: string,
  bucket: number,
): string {
  return `search-postings.v1/${safeGenerationForObjectKey(generation)}/directory/${safeBucketForObjectKey(bucket)}.json`;
}

export function staticSearchPostingPageObjectKey(
  generation: string,
  bucket: number,
  page: number,
): string {
  return `search-postings.v1/${safeGenerationForObjectKey(generation)}/bucket/${safeBucketForObjectKey(bucket)}/${safePageForObjectKey(page)}.json`;
}
