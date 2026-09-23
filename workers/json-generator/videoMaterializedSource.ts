import { cancelR2BodyBestEffort } from "../../src/lib/r2Body.ts";
import { staticArtifactContentHash } from "./r2Dedup.ts";

export const VIDEO_MATERIALIZED_SOURCE_SCHEMA_VERSION = 1;
export const VIDEO_MATERIALIZED_SOURCE_MAX_ROWS = 5000;
export const VIDEO_MATERIALIZED_SOURCE_MAX_BYTES = 16 * 1024 * 1024;
export const VIDEO_MATERIALIZED_SOURCE_MANIFEST_KEY =
  "internal/materialized/video-cards/v1/manifest.json";

const VIDEO_SOURCE_PREFIX = "internal/materialized/video-cards/v1/g";
export const VIDEO_MATERIALIZED_SOURCE_MAX_MANIFEST_BYTES = 16 * 1024;
const MAX_CAS_ATTEMPTS = 3;

export type VideoMaterializedRow = {
  id: string;
  title: string;
  youtube_video_id: string | null;
  display_name: string;
  creator_display_name: string;
  creator_x_user_id: string | null;
  icon_url: string | null;
  creator_icon_url: string | null;
  primary_event_id: string | null;
  primary_event_title: string | null;
  scheduled_time: number | null;
  status: "public";
  part: string | null;
  score: number;
  score_updated_at: number | null;
  updated_at: number;
  youtube_privacy_status: string | null;
  youtube_availability_status: string | null;
};

export type VideoMaterializedSource = {
  schema_version: 1;
  generation: string;
  score_watermark: number;
  source_updated_at: number;
  rows: VideoMaterializedRow[];
};

export type VideoMaterializedSourceManifest = {
  schema_version: 1;
  generation: string;
  source_key: string;
  previous_source_key: string | null;
  row_count: number;
  score_watermark: number;
  source_updated_at: number;
  published_at: number;
};

export type VideoMaterializedSourceEnv = {
  R2: R2Bucket;
};

export type LoadedVideoMaterializedSource = {
  source: VideoMaterializedSource | null;
  manifest: VideoMaterializedSourceManifest | null;
  manifestEtag: string | null;
};

export function videoMaterializedSourceObjectKey(generation: string): string {
  if (!/^[a-f0-9]{64}$/.test(generation)) {
    throw new Error("invalid_video_materialized_generation");
  }
  return `${VIDEO_SOURCE_PREFIX}/${generation}.json`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseManifest(value: unknown): VideoMaterializedSourceManifest | null {
  if (!isRecord(value)) return null;
  const generation = String(value.generation ?? "");
  const sourceKey = videoMaterializedSourceObjectKeySafe(generation);
  const previousSourceKey = value.previous_source_key ?? null;
  const previousGeneration =
    typeof previousSourceKey === "string"
      ? previousSourceKey.slice(`${VIDEO_SOURCE_PREFIX}/`.length, -".json".length)
      : null;
  const safePreviousSourceKey = previousGeneration
    ? videoMaterializedSourceObjectKeySafe(previousGeneration)
    : null;
  if (
    value.schema_version !== VIDEO_MATERIALIZED_SOURCE_SCHEMA_VERSION ||
    !sourceKey ||
    value.source_key !== sourceKey ||
    (previousSourceKey !== null &&
      (typeof previousSourceKey !== "string" ||
        safePreviousSourceKey !== previousSourceKey)) ||
    !Number.isSafeInteger(value.row_count) ||
    Number(value.row_count) < 0 ||
    Number(value.row_count) > VIDEO_MATERIALIZED_SOURCE_MAX_ROWS ||
    !Number.isSafeInteger(value.score_watermark) ||
    Number(value.score_watermark) < 0 ||
    !Number.isSafeInteger(value.source_updated_at) ||
    Number(value.source_updated_at) < 0 ||
    !Number.isSafeInteger(value.published_at)
  ) {
    return null;
  }
  return {
    schema_version: 1,
    generation,
    source_key: sourceKey,
    previous_source_key: typeof previousSourceKey === "string" ? previousSourceKey : null,
    row_count: Number(value.row_count),
    score_watermark: Number(value.score_watermark),
    source_updated_at: Number(value.source_updated_at),
    published_at: Number(value.published_at),
  };
}

function videoMaterializedSourceObjectKeySafe(generation: string): string | null {
  return /^[a-f0-9]{64}$/.test(generation)
    ? `${VIDEO_SOURCE_PREFIX}/${generation}.json`
    : null;
}

function normalizeRow(value: unknown): VideoMaterializedRow | null {
  if (!isRecord(value)) return null;
  const id = String(value.id ?? "").trim();
  const title = String(value.title ?? "").trim();
  const displayName = String(value.display_name ?? "").trim();
  const creatorDisplayName = String(value.creator_display_name ?? "").trim();
  const score = Number(value.score);
  const updatedAt = Number(value.updated_at);
  if (
    !id || !title || !displayName || !creatorDisplayName ||
    value.status !== "public" || !Number.isFinite(score) ||
    !Number.isSafeInteger(updatedAt) || updatedAt < 0
  ) return null;
  const scheduledTime = value.scheduled_time == null ? null : Number(value.scheduled_time);
  const scoreUpdatedAt = value.score_updated_at == null ? null : Number(value.score_updated_at);
  if (
    (scheduledTime !== null && !Number.isFinite(scheduledTime)) ||
    (scoreUpdatedAt !== null && (!Number.isSafeInteger(scoreUpdatedAt) || scoreUpdatedAt < 0))
  ) return null;
  return {
    id,
    title,
    youtube_video_id: nullableString(value.youtube_video_id),
    display_name: displayName,
    creator_display_name: creatorDisplayName,
    creator_x_user_id: nullableString(value.creator_x_user_id),
    icon_url: nullableString(value.icon_url),
    creator_icon_url: nullableString(value.creator_icon_url),
    primary_event_id: nullableString(value.primary_event_id),
    primary_event_title: nullableString(value.primary_event_title),
    scheduled_time: scheduledTime,
    status: "public",
    part: nullableString(value.part),
    score,
    score_updated_at: scoreUpdatedAt,
    updated_at: updatedAt,
    youtube_privacy_status: nullableString(value.youtube_privacy_status),
    youtube_availability_status: nullableString(value.youtube_availability_status),
  };
}

function nullableString(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function parseSource(value: unknown): VideoMaterializedSource | null {
  if (!isRecord(value) || !Array.isArray(value.rows)) return null;
  const generation = String(value.generation ?? "");
  const rows = value.rows.map(normalizeRow);
  if (
    value.schema_version !== VIDEO_MATERIALIZED_SOURCE_SCHEMA_VERSION ||
    !/^[a-f0-9]{64}$/.test(generation) ||
    rows.length > VIDEO_MATERIALIZED_SOURCE_MAX_ROWS ||
    rows.some((row) => row === null) ||
    !Number.isSafeInteger(value.score_watermark) ||
    !Number.isSafeInteger(value.source_updated_at)
  ) return null;
  const normalizedRows = rows as VideoMaterializedRow[];
  if (new Set(normalizedRows.map((row) => row.id)).size !== normalizedRows.length) {
    return null;
  }
  return {
    schema_version: 1,
    generation,
    score_watermark: Number(value.score_watermark),
    source_updated_at: Number(value.source_updated_at),
    rows: normalizedRows,
  };
}

async function readJsonObject<T>(
  bucket: R2Bucket,
  key: string,
  maxBytes: number,
): Promise<T | null> {
  const object = await bucket.get(key);
  if (!object) return null;
  if (
    typeof object.size === "number" &&
    (!Number.isSafeInteger(object.size) || object.size < 0 || object.size > maxBytes)
  ) {
    await cancelR2BodyBestEffort(object);
    return null;
  }
  try {
    return await object.json<T>();
  } catch {
    return null;
  }
}

/** Manifest is the sole commit point. Retry once when a concurrent GC removed a prior source. */
export async function loadVideoMaterializedSource(
  env: VideoMaterializedSourceEnv,
  signal?: AbortSignal,
): Promise<LoadedVideoMaterializedSource | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    signal?.throwIfAborted();
    const manifestObject = await env.R2.get(VIDEO_MATERIALIZED_SOURCE_MANIFEST_KEY);
    if (!manifestObject) return null;
    if (
      typeof manifestObject.size === "number" &&
      manifestObject.size > VIDEO_MATERIALIZED_SOURCE_MAX_MANIFEST_BYTES
    ) {
      await cancelR2BodyBestEffort(manifestObject);
      // Keep the current etag so bootstrap can replace a corrupt manifest with
      // an If-Match write instead of treating the occupied key as absent.
      return {
        source: null,
        manifest: null,
        manifestEtag: manifestObject.etag ?? null,
      };
    }
    let rawManifest: unknown;
    try {
      rawManifest = await manifestObject.json<unknown>();
    } catch {
      return {
        source: null,
        manifest: null,
        manifestEtag: manifestObject.etag ?? null,
      };
    }
    const manifest = parseManifest(rawManifest);
    if (!manifest || !manifestObject.etag) {
      return {
        source: null,
        manifest: null,
        manifestEtag: manifestObject.etag ?? null,
      };
    }
    const rawSource = await readJsonObject<unknown>(
      env.R2,
      manifest.source_key,
      VIDEO_MATERIALIZED_SOURCE_MAX_BYTES,
    );
    const source = parseSource(rawSource);
    const sourceHash = source
      ? await staticArtifactContentHash(JSON.stringify({
          schema_version: source.schema_version,
          score_watermark: source.score_watermark,
          source_updated_at: source.source_updated_at,
          rows: source.rows,
        }))
      : null;
    if (
      source &&
      sourceHash === manifest.generation &&
      source.generation === manifest.generation &&
      source.rows.length === manifest.row_count &&
      source.score_watermark === manifest.score_watermark &&
      source.source_updated_at === manifest.source_updated_at
    ) {
      return { source, manifest, manifestEtag: manifestObject.etag };
    }
    if (attempt === 1) {
      return {
        source: null,
        manifest,
        manifestEtag: manifestObject.etag,
      };
    }
  }
  return { source: null, manifest: null, manifestEtag: null };
}

export async function publishVideoMaterializedSource(
  env: VideoMaterializedSourceEnv,
  rows: readonly VideoMaterializedRow[],
  options: {
    expectedEtag: string | null;
    currentManifest: VideoMaterializedSourceManifest | null;
    allowSameGenerationSkip?: boolean;
    scoreWatermark: number;
    sourceUpdatedAt: number;
    signal?: AbortSignal;
  },
): Promise<"published" | "unchanged" | "conflict"> {
  options.signal?.throwIfAborted();
  if (rows.length > VIDEO_MATERIALIZED_SOURCE_MAX_ROWS) {
    throw new Error("video_materialized_source_exceeds_max_rows");
  }
  const normalizedRows = rows.map(normalizeRow);
  if (normalizedRows.some((row) => row === null)) {
    throw new Error("video_materialized_source_contains_invalid_row");
  }
  const sourceMaterial = {
    schema_version: VIDEO_MATERIALIZED_SOURCE_SCHEMA_VERSION,
    score_watermark: options.scoreWatermark,
    source_updated_at: options.sourceUpdatedAt,
    rows: normalizedRows as VideoMaterializedRow[],
  };
  const generation = await staticArtifactContentHash(JSON.stringify(sourceMaterial));
  const source: VideoMaterializedSource = { ...sourceMaterial, generation };
  const serializedSource = JSON.stringify(source);
  const sourceBytes = new TextEncoder().encode(serializedSource).byteLength;
  if (sourceBytes > VIDEO_MATERIALIZED_SOURCE_MAX_BYTES) {
    throw new Error("video_materialized_source_exceeds_max_bytes");
  }
  const sourceKey = videoMaterializedSourceObjectKey(generation);
  if (
    options.allowSameGenerationSkip !== false &&
    options.currentManifest?.generation === generation
  ) return "unchanged";

  options.signal?.throwIfAborted();
  const sourcePut = await env.R2.put(sourceKey, serializedSource, {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: {
      flamenode_schema: String(VIDEO_MATERIALIZED_SOURCE_SCHEMA_VERSION),
      flamenode_generation: generation,
    },
    onlyIf: new Headers({ "If-None-Match": "*" }),
  });
  if (!sourcePut) {
    const existing = await env.R2.head(sourceKey);
    if (existing?.customMetadata?.flamenode_generation !== generation) {
      throw new Error("video_materialized_source_generation_conflict");
    }
    if (options.allowSameGenerationSkip === false && existing?.etag) {
      const existingObject = await env.R2.get(sourceKey);
      if (!existingObject) return "conflict";
      const existingBody = await existingObject.text();
      if (existingBody !== serializedSource) {
        const repaired = await env.R2.put(sourceKey, serializedSource, {
          httpMetadata: { contentType: "application/json; charset=utf-8" },
          customMetadata: {
            flamenode_schema: String(VIDEO_MATERIALIZED_SOURCE_SCHEMA_VERSION),
            flamenode_generation: generation,
          },
          onlyIf: { etagMatches: existing.etag },
        });
        if (!repaired) return "conflict";
      }
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const manifest: VideoMaterializedSourceManifest = {
    schema_version: 1,
    generation,
    source_key: sourceKey,
    previous_source_key: options.currentManifest?.source_key ?? null,
    row_count: normalizedRows.length,
    score_watermark: options.scoreWatermark,
    source_updated_at: options.sourceUpdatedAt,
    published_at: now,
  };
  const putOptions: R2PutOptions = {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: {
      flamenode_schema: String(VIDEO_MATERIALIZED_SOURCE_SCHEMA_VERSION),
      flamenode_generation: generation,
    },
    ...(options.expectedEtag
      ? { onlyIf: { etagMatches: options.expectedEtag } }
      : { onlyIf: new Headers({ "If-None-Match": "*" }) }),
  };
  options.signal?.throwIfAborted();
  const committed = await env.R2.put(
    VIDEO_MATERIALIZED_SOURCE_MANIFEST_KEY,
    JSON.stringify(manifest),
    putOptions,
  );
  if (!committed) {
    const latest = await loadVideoMaterializedSource(env, options.signal);
    if (latest?.manifest?.generation === generation) return "unchanged";
    try {
      await env.R2.delete(sourceKey);
    } catch {
      // An unreferenced immutable object is safe; a later repair can collect it.
    }
    return "conflict";
  }

  const obsoleteKey = options.currentManifest?.previous_source_key;
  if (obsoleteKey && obsoleteKey !== sourceKey) {
    try {
      await env.R2.delete(obsoleteKey);
    } catch {
      // Keep the published manifest authoritative; cleanup is best effort.
    }
  }
  return "published";
}

export async function mutateVideoMaterializedSource(
  env: VideoMaterializedSourceEnv,
  patch: (
    rows: VideoMaterializedRow[],
    current: VideoMaterializedSource | null,
  ) => Promise<{
    rows: VideoMaterializedRow[];
    scoreWatermark?: number;
    sourceUpdatedAt?: number;
  } | null>,
  options: {
    bootstrap: () => Promise<VideoMaterializedRow[] | null>;
    signal?: AbortSignal;
  },
): Promise<{ source: VideoMaterializedSource; changed: boolean } | null> {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    options.signal?.throwIfAborted();
    const loaded = await loadVideoMaterializedSource(env, options.signal);
    const current = loaded?.source ?? null;
    const baseRows = current?.rows ?? await options.bootstrap();
    if (!baseRows) return null;
    const patched = await patch([...baseRows], current);
    if (!patched) return current ? { source: current, changed: false } : null;
    const scoreWatermark = patched.scoreWatermark ?? current?.score_watermark ?? 0;
    const sourceUpdatedAt = patched.sourceUpdatedAt ??
      Math.max(0, ...patched.rows.map((row) => row.updated_at));
    const result = await publishVideoMaterializedSource(env, patched.rows, {
      expectedEtag: loaded?.manifestEtag ?? null,
      currentManifest: loaded?.manifest ?? null,
      allowSameGenerationSkip: Boolean(current),
      scoreWatermark,
      sourceUpdatedAt,
      signal: options.signal,
    });
    if (result !== "conflict") {
      const committed = await loadVideoMaterializedSource(env, options.signal);
      if (committed?.source) {
        return { source: committed.source, changed: result === "published" };
      }
      throw new Error("video_materialized_source_missing_after_publish");
    }
  }
  throw new Error("video_materialized_source_manifest_cas_conflict");
}
