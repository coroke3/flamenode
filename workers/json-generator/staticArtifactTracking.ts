import { throwIfAborted } from "../shared/abort.ts";
import type { ArtifactHashCache } from "./r2Dedup.ts";

export type StaticArtifactTrackingTarget = {
  targetType: string;
  targetId: string;
  schemaVersion: number;
  sourceUpdatedAt?: number | null;
  /** Unix seconds; defaults to now. */
  generatedAt?: number;
};

export type TrackedStaticArtifact = { objectKey: string; contentHash: string };

const RECORD_CHUNK_SIZE = 500;

/**
 * Upsert live `static_artifacts` rows, one JSON1 statement per 500 objects,
 * and remember each hash for the next R2 dedup check.
 */
export async function recordStaticArtifacts(
  env: { DB: D1Database; artifactHashCache?: ArtifactHashCache },
  target: StaticArtifactTrackingTarget,
  artifacts: readonly TrackedStaticArtifact[],
  signal?: AbortSignal,
): Promise<void> {
  const generatedAt = target.generatedAt ?? Math.floor(Date.now() / 1000);
  for (let offset = 0; offset < artifacts.length; offset += RECORD_CHUNK_SIZE) {
    throwIfAborted(signal, "static rebuild aborted");
    const chunk = artifacts.slice(offset, offset + RECORD_CHUNK_SIZE);
    await env.DB.prepare(
      `WITH artifacts AS (
         SELECT
           json_extract(value, '$.objectKey') AS object_key,
           json_extract(value, '$.contentHash') AS content_hash
         FROM json_each(?1)
       )
       INSERT INTO static_artifacts
         (id, target_type, target_id, object_key, content_hash, schema_version,
          source_updated_at, generated_at, deleted_at)
       SELECT
         'sta:' || ?2 || ':' || ?3 || ':' || artifacts.object_key,
         ?2, ?3, artifacts.object_key, artifacts.content_hash, ?4, ?5, ?6, NULL
       FROM artifacts
       WHERE artifacts.object_key IS NOT NULL
       ON CONFLICT(target_type, target_id, object_key) DO UPDATE SET
         content_hash = excluded.content_hash,
         schema_version = excluded.schema_version,
         source_updated_at = excluded.source_updated_at,
         generated_at = excluded.generated_at,
         deleted_at = NULL`,
    )
      .bind(
        JSON.stringify(chunk.map(({ objectKey, contentHash }) => ({ objectKey, contentHash }))),
        target.targetType,
        target.targetId,
        target.schemaVersion,
        target.sourceUpdatedAt ?? null,
        generatedAt,
      )
      .run();
    for (const artifact of chunk) {
      env.artifactHashCache?.set(artifact.objectKey, artifact.contentHash);
    }
  }
  throwIfAborted(signal, "static rebuild aborted");
}
