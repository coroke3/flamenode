import {
  buildStaticSearchPostingArtifacts,
  normalizeStaticSearchPostingDirectory,
  normalizeStaticSearchPostingManifest,
  normalizeStaticSearchPostingPage,
  staticSearchPostingBucket,
  staticSearchQueryGrams,
  STATIC_SEARCH_POSTINGS_BUCKET_COUNT,
  type StaticSearchPostingDirectory,
  type StaticSearchPostingManifest,
  type StaticSearchPostingPage,
} from "../publicData/staticSearchPostingsCore.ts";
import { normalizeMemberSearchText } from "./memberSuggestionRank.ts";
import {
  MEMBER_SUGGESTIONS_MAX_NAME_ALIASES,
  MEMBER_SUGGESTIONS_MAX_X_ALIASES,
  type MemberSuggestionItem,
} from "./memberSuggestionsCore.ts";

export const MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY =
  "internal/member-suggestions/v2/manifest.json";
export const MEMBER_SUGGESTIONS_V2_GENERATION_PREFIX =
  "internal/member-suggestions/v2/g";
export const MEMBER_SUGGESTIONS_V2_MAX_QUERY_PAGES = 8;
export const MEMBER_SUGGESTIONS_V2_MAX_CANDIDATES = 1536;
export const MEMBER_SUGGESTIONS_V2_MAX_ARTIFACT_BYTES = 1024 * 1024;
/**
 * 内部候補APIは2文字未満をR2検索へ流さないため、1文字postingは到達不能。
 * 生成対象から除外してR2 object数・generator CPU・40-object budget消費を抑える。
 */
export const MEMBER_SUGGESTIONS_V2_MIN_GRAM_LENGTH = 2;

function safeGeneration(value: string): string {
  const generation = value.trim();
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(generation)) {
    throw new Error("invalid member suggestions v2 generation");
  }
  return generation;
}

function safeBucket(bucket: number): number {
  if (
    !Number.isSafeInteger(bucket) ||
    bucket < 0 ||
    bucket >= STATIC_SEARCH_POSTINGS_BUCKET_COUNT
  ) {
    throw new Error("invalid member suggestions v2 bucket");
  }
  return bucket;
}

function safePage(page: number): number {
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new Error("invalid member suggestions v2 page");
  }
  return page;
}

export function memberSuggestionsV2DirectoryObjectKey(
  generation: string,
  bucket: number,
): string {
  return `${MEMBER_SUGGESTIONS_V2_GENERATION_PREFIX}/${safeGeneration(generation)}/directory/${safeBucket(bucket)}.json`;
}

export function memberSuggestionsV2PageObjectKey(
  generation: string,
  bucket: number,
  page: number,
): string {
  return `${MEMBER_SUGGESTIONS_V2_GENERATION_PREFIX}/${safeGeneration(generation)}/bucket/${safeBucket(bucket)}/${safePage(page)}.json`;
}

function memberSuggestionGramLength(gram: string): number {
  return [...gram].length;
}

/**
 * 共通posting builderは1/2/3文字gramを生成するが、このAPIは2文字未満を
 * request pathで拒否する。到達不能な1文字record/directory/pageをpublish前に落とす。
 * page番号はgeneration固有object keyなので詰め直さず、directoryが参照する番号を維持する。
 */
function removeUnqueriedShortGrams(
  artifacts: ReturnType<typeof buildStaticSearchPostingArtifacts<MemberSuggestionItem>>,
): ReturnType<typeof buildStaticSearchPostingArtifacts<MemberSuggestionItem>> {
  const pages = artifacts.pages
    .map(({ bucket, page }) => {
      const records = page.records.filter(
        (record) =>
          memberSuggestionGramLength(record.gram) >=
          MEMBER_SUGGESTIONS_V2_MIN_GRAM_LENGTH,
      );
      if (records.length === 0) return null;
      return { bucket, page: { ...page, records } };
    })
    .filter(
      (
        entry,
      ): entry is ReturnType<
        typeof buildStaticSearchPostingArtifacts<MemberSuggestionItem>
      >["pages"][number] => entry !== null,
    );

  const directories = artifacts.directories
    .map(({ bucket, directory }) => {
      const grams = Object.fromEntries(
        Object.entries(directory.grams).filter(
          ([gram]) =>
            memberSuggestionGramLength(gram) >=
            MEMBER_SUGGESTIONS_V2_MIN_GRAM_LENGTH,
        ),
      );
      if (Object.keys(grams).length === 0) return null;
      return { bucket, directory: { ...directory, grams } };
    })
    .filter(
      (
        entry,
      ): entry is ReturnType<
        typeof buildStaticSearchPostingArtifacts<MemberSuggestionItem>
      >["directories"][number] => entry !== null,
    );

  return {
    manifest: {
      ...artifacts.manifest,
      buckets: directories.map(({ bucket }) => bucket),
    },
    directories,
    pages,
  };
}

export function buildMemberSuggestionsV2Artifacts(args: {
  items: readonly MemberSuggestionItem[];
  generatedAt: number;
  generation: string;
}) {
  const artifacts = buildStaticSearchPostingArtifacts({
    items: args.items,
    generatedAt: args.generatedAt,
    generation: args.generation,
    keyOf: (item) => item.x_user_id,
    textOf: (item) => [
      item.x_user_id,
      item.name,
      ...item.xAliases,
      ...item.nameAliases,
    ].map(normalizeMemberSearchText),
  });
  return removeUnqueriedShortGrams(artifacts);
}

export function memberSuggestionQueryGrams(query: string): string[] {
  return staticSearchQueryGrams(normalizeMemberSearchText(query));
}

export function memberSuggestionPostingBucket(gram: string): number {
  return staticSearchPostingBucket(gram);
}

export function normalizeMemberSuggestionsV2Manifest(
  value: unknown,
): StaticSearchPostingManifest | null {
  return normalizeStaticSearchPostingManifest(value);
}

export function normalizeMemberSuggestionsV2Directory(
  value: unknown,
): StaticSearchPostingDirectory | null {
  return normalizeStaticSearchPostingDirectory(value);
}

function normalizeStringArray(
  value: unknown,
  maxLength: number,
  validate: (entry: string) => boolean,
): string[] | null {
  if (!Array.isArray(value) || value.length > maxLength) return null;
  const output: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !validate(entry)) return null;
    output.push(entry);
  }
  return output;
}

export function normalizeMemberSuggestionPostingItem(
  value: unknown,
): MemberSuggestionItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.x_user_id !== "string" ||
    !/^[a-z0-9_]{1,64}$/.test(row.x_user_id)
  ) {
    return null;
  }
  if (typeof row.name !== "string" || !row.name.trim()) return null;
  const xAliases = normalizeStringArray(
    row.xAliases,
    MEMBER_SUGGESTIONS_MAX_X_ALIASES,
    (entry) => /^[a-z0-9_]{1,64}$/.test(entry) && entry !== row.x_user_id,
  );
  const nameAliases = normalizeStringArray(
    row.nameAliases,
    MEMBER_SUGGESTIONS_MAX_NAME_ALIASES,
    (entry) => entry.trim().length > 0,
  );
  if (!xAliases || !nameAliases) return null;
  const occurrenceCount = Number(row.occurrenceCount ?? 0);
  if (!Number.isSafeInteger(occurrenceCount) || occurrenceCount < 0) return null;
  let lastSeenAt: number | null = null;
  if (row.lastSeenAt != null) {
    const lastSeen = Number(row.lastSeenAt);
    if (!Number.isSafeInteger(lastSeen)) return null;
    lastSeenAt = lastSeen;
  }
  const approvalStatus = row.approvalStatus;
  if (approvalStatus != null && typeof approvalStatus !== "string") return null;
  return {
    x_user_id: row.x_user_id,
    name: row.name,
    xAliases,
    nameAliases,
    occurrenceCount,
    lastSeenAt,
    approvalStatus: approvalStatus ?? null,
  };
}

export function normalizeMemberSuggestionsV2Page(
  value: unknown,
): StaticSearchPostingPage<MemberSuggestionItem> | null {
  return normalizeStaticSearchPostingPage(
    value,
    normalizeMemberSuggestionPostingItem,
  );
}

export function memberSuggestionsV2ArtifactByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
