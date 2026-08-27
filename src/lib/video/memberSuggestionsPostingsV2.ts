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
import type { MemberSuggestionItem } from "./memberSuggestionsCore.ts";

export const MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY =
  "internal/member-suggestions/v2/manifest.json";
export const MEMBER_SUGGESTIONS_V2_GENERATION_PREFIX =
  "internal/member-suggestions/v2/g";
export const MEMBER_SUGGESTIONS_V2_MAX_QUERY_PAGES = 8;
export const MEMBER_SUGGESTIONS_V2_MAX_CANDIDATES = 1536;
export const MEMBER_SUGGESTIONS_V2_MAX_ARTIFACT_BYTES = 1024 * 1024;

function safeGeneration(value: string): string {
  const generation = value.trim();
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(generation)) {
    throw new Error("invalid member suggestions v2 generation");
  }
  return generation;
}

function safeBucket(bucket: number): number {
  const value = Math.floor(bucket);
  if (value < 0 || value >= STATIC_SEARCH_POSTINGS_BUCKET_COUNT) {
    throw new Error("invalid member suggestions v2 bucket");
  }
  return value;
}

function safePage(page: number): number {
  const value = Math.floor(page);
  if (value < 1) throw new Error("invalid member suggestions v2 page");
  return value;
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

export function buildMemberSuggestionsV2Artifacts(args: {
  items: readonly MemberSuggestionItem[];
  generatedAt: number;
  generation: string;
}) {
  return buildStaticSearchPostingArtifacts({
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

function normalizeStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const output: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return null;
    output.push(entry);
  }
  return output;
}

export function normalizeMemberSuggestionPostingItem(
  value: unknown,
): MemberSuggestionItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.x_user_id !== "string" || !/^[a-z0-9_]{1,64}$/.test(row.x_user_id)) {
    return null;
  }
  if (typeof row.name !== "string" || !row.name.trim()) return null;
  const xAliases = normalizeStringArray(row.xAliases);
  const nameAliases = normalizeStringArray(row.nameAliases);
  if (!xAliases || !nameAliases) return null;
  const occurrenceCount = Number(row.occurrenceCount ?? 0);
  if (!Number.isFinite(occurrenceCount) || occurrenceCount < 0) return null;
  let lastSeenAt: number | null = null;
  if (row.lastSeenAt != null) {
    const value = Number(row.lastSeenAt);
    if (!Number.isFinite(value)) return null;
    lastSeenAt = Math.floor(value);
  }
  const approvalStatus = row.approvalStatus;
  if (approvalStatus != null && typeof approvalStatus !== "string") return null;
  return {
    x_user_id: row.x_user_id,
    name: row.name,
    xAliases,
    nameAliases,
    occurrenceCount: Math.floor(occurrenceCount),
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
