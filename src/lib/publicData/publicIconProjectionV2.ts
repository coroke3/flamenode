import { normalizeXId } from "../utils/xid.ts";
import {
  normalizePublicIconUrl,
  type PublicXIconEntry,
  type PublicXIconMapPayload,
} from "./publicIconProjection.ts";

export const PUBLIC_X_ICON_V2_SCHEMA_VERSION = 2 as const;
export const PUBLIC_X_ICON_V2_SHARD_COUNT = 16;
export const PUBLIC_X_ICON_V2_MANIFEST_OBJECT_KEY =
  "users/public-icons/v2/manifest.json";
export const PUBLIC_X_ICON_V2_GENERATION_PREFIX = "users/public-icons/v2/g";
export const PUBLIC_X_ICON_V2_MAX_MANIFEST_BYTES = 64 * 1024;
export const PUBLIC_X_ICON_V2_MAX_SHARD_BYTES = 1024 * 1024;
export const PUBLIC_X_ICON_V2_LAYOUT_VERSION = 1;

export type PublicXIconV2Manifest = {
  schema_version: 2;
  generation: string;
  generated_at: number;
  shard_count: 16;
  shards: number[];
};

export type PublicXIconV2Shard = {
  schema_version: 2;
  generation: string;
  generated_at: number;
  shard: number;
  entries: Record<string, PublicXIconEntry>;
};

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function publicXIconV2ShardForXId(value: string): number {
  const xId = normalizeXId(value);
  if (!xId) return 0;
  return stableHash(xId) % PUBLIC_X_ICON_V2_SHARD_COUNT;
}

function safeGeneration(value: string): string {
  const generation = value.trim();
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(generation)) {
    throw new Error("invalid public icon v2 generation");
  }
  return generation;
}

export function publicXIconV2ShardObjectKey(
  generation: string,
  shard: number,
): string {
  if (
    !Number.isSafeInteger(shard) ||
    shard < 0 ||
    shard >= PUBLIC_X_ICON_V2_SHARD_COUNT
  ) {
    throw new Error("invalid public icon v2 shard");
  }
  return `${PUBLIC_X_ICON_V2_GENERATION_PREFIX}/${safeGeneration(generation)}/${shard
    .toString(16)
    .padStart(2, "0")}.json`;
}

export function publicXIconV2GenerationMaterial(
  payload: PublicXIconMapPayload,
): string {
  return JSON.stringify({
    layout_version: PUBLIC_X_ICON_V2_LAYOUT_VERSION,
    entries: Object.entries(payload.entries)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([xId, entry]) => [xId, entry.icon_url, entry.source]),
  });
}

export function buildPublicXIconV2Artifacts(args: {
  payload: PublicXIconMapPayload;
  generation: string;
}): {
  manifest: PublicXIconV2Manifest;
  shards: PublicXIconV2Shard[];
} {
  const generation = safeGeneration(args.generation);
  const buckets = Array.from(
    { length: PUBLIC_X_ICON_V2_SHARD_COUNT },
    () => ({} as Record<string, PublicXIconEntry>),
  );

  for (const [rawXId, entry] of Object.entries(args.payload.entries)) {
    const xId = normalizeXId(rawXId);
    if (!xId) continue;
    const shard = publicXIconV2ShardForXId(xId);
    buckets[shard][xId] = {
      icon_url: normalizePublicIconUrl(entry.icon_url),
      source: entry.source,
    };
  }

  const shards = buckets.flatMap((entries, shard) =>
    Object.keys(entries).length === 0
      ? []
      : [
          {
            schema_version: PUBLIC_X_ICON_V2_SCHEMA_VERSION,
            generation,
            generated_at: args.payload.generated_at,
            shard,
            entries,
          } satisfies PublicXIconV2Shard,
        ],
  );

  return {
    manifest: {
      schema_version: PUBLIC_X_ICON_V2_SCHEMA_VERSION,
      generation,
      generated_at: args.payload.generated_at,
      shard_count: PUBLIC_X_ICON_V2_SHARD_COUNT,
      shards: shards.map((shard) => shard.shard),
    },
    shards,
  };
}

function normalizeGeneration(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const generation = value.trim();
  return /^[A-Za-z0-9._-]{1,128}$/.test(generation) ? generation : null;
}

export function normalizePublicXIconV2Manifest(
  value: unknown,
): PublicXIconV2Manifest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.schema_version !== PUBLIC_X_ICON_V2_SCHEMA_VERSION) return null;
  const generation = normalizeGeneration(row.generation);
  if (!generation || Number(row.shard_count) !== PUBLIC_X_ICON_V2_SHARD_COUNT) {
    return null;
  }
  if (!Array.isArray(row.shards)) return null;
  const shards = [...new Set(row.shards.map(Number))];
  if (
    shards.some(
      (shard) =>
        !Number.isInteger(shard) ||
        shard < 0 ||
        shard >= PUBLIC_X_ICON_V2_SHARD_COUNT,
    )
  ) {
    return null;
  }
  const generatedAt = Number(row.generated_at);
  return {
    schema_version: PUBLIC_X_ICON_V2_SCHEMA_VERSION,
    generation,
    generated_at:
      Number.isFinite(generatedAt) && generatedAt >= 0
        ? Math.floor(generatedAt)
        : 0,
    shard_count: PUBLIC_X_ICON_V2_SHARD_COUNT,
    shards: shards.sort((a, b) => a - b),
  };
}

export function normalizePublicXIconV2Shard(
  value: unknown,
  expected: { generation: string; shard: number },
): PublicXIconV2Shard | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.schema_version !== PUBLIC_X_ICON_V2_SCHEMA_VERSION) return null;
  if (row.generation !== expected.generation || Number(row.shard) !== expected.shard) {
    return null;
  }
  if (!row.entries || typeof row.entries !== "object" || Array.isArray(row.entries)) {
    return null;
  }

  const entries: Record<string, PublicXIconEntry> = {};
  for (const [rawXId, rawEntry] of Object.entries(
    row.entries as Record<string, unknown>,
  )) {
    const xId = normalizeXId(rawXId);
    if (!xId || publicXIconV2ShardForXId(xId) !== expected.shard) return null;
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
      return null;
    }
    const entry = rawEntry as Record<string, unknown>;
    if (
      entry.source !== "registered" &&
      entry.source !== "video" &&
      entry.source !== "none"
    ) {
      return null;
    }
    entries[xId] = {
      icon_url: normalizePublicIconUrl(entry.icon_url),
      source: entry.source,
    };
  }

  const generatedAt = Number(row.generated_at);
  return {
    schema_version: PUBLIC_X_ICON_V2_SCHEMA_VERSION,
    generation: expected.generation,
    generated_at:
      Number.isFinite(generatedAt) && generatedAt >= 0
        ? Math.floor(generatedAt)
        : 0,
    shard: expected.shard,
    entries,
  };
}

export function publicXIconV2ArtifactByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
