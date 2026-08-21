import { assertNoForbiddenPublicKeys } from "./sanitize.ts";
import {
  resolveIdenticalJsonArtifactPut,
  staticArtifactContentHash,
  type ArtifactHashCache,
} from "./r2Dedup.ts";
import {
  staticR2CacheControl,
  STATIC_R2_MAX_AGE_SEC,
} from "../shared/staticR2CacheControl.ts";
import {
  buildUsersIndexV2Artifacts,
  USERS_INDEX_V2_MANIFEST_OBJECT_KEY,
  USERS_INDEX_V2_MAX_MANIFEST_BYTES,
  USERS_INDEX_V2_MAX_PAGE_BYTES,
  USERS_SEARCH_LITE_V1_MAX_BYTES,
  USERS_SEARCH_LITE_V1_OBJECT_KEY,
  usersIndexV2ArtifactByteLength,
  usersIndexV2ScorePageObjectKey,
  type UsersIndexV2SourceEntry,
} from "../../src/lib/publicData/staticUsersIndexV2Core.ts";

const USERS_INDEX_V2_ARTIFACT_TARGET_TYPE = "users_index_v2";
const USERS_INDEX_V2_ARTIFACT_TARGET_ID = "global";
const USERS_INDEX_V2_STATIC_ARTIFACT_SCHEMA_VERSION = 2;
const USERS_INDEX_V2_CLEANUP_LIMIT = 500;

type Env = {
  DB: D1Database;
  R2: R2Bucket;
  artifactHashCache?: ArtifactHashCache;
};

type RebuildSignal = AbortSignal | undefined;

type TrackedArtifactRow = {
  object_key: string;
};

function throwIfAborted(signal: RebuildSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new Error(signal.reason === undefined ? "static rebuild aborted" : String(signal.reason));
}

function assertArtifactSize(key: string, value: unknown, maxBytes: number): void {
  const byteLength = usersIndexV2ArtifactByteLength(value);
  if (byteLength > maxBytes) {
    throw new Error(`${key} exceeds size limit (${byteLength} > ${maxBytes} bytes)`);
  }
}

function generationMaterial(items: readonly UsersIndexV2SourceEntry[]): string {
  return JSON.stringify(
    items.map((item) => ({
      x_id: item.x_id,
      x_name: item.x_name,
      icon_url: item.icon_url,
      personal_count: item.personal_count,
      collab_count: item.collab_count,
      total_works: item.total_works,
      sort_score: item.sort_score,
    })),
  );
}

async function recordArtifact(
  env: Env,
  objectKey: string,
  serialized: string,
  signal?: RebuildSignal,
): Promise<void> {
  throwIfAborted(signal);
  const contentHash = await staticArtifactContentHash(serialized);
  throwIfAborted(signal);
  const now = Math.floor(Date.now() / 1000);
  const id = `sta:${USERS_INDEX_V2_ARTIFACT_TARGET_TYPE}:${USERS_INDEX_V2_ARTIFACT_TARGET_ID}:${objectKey}`;
  await env.DB.prepare(
    `INSERT INTO static_artifacts
       (id, target_type, target_id, object_key, content_hash, schema_version,
        source_updated_at, generated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL)
     ON CONFLICT(target_type, target_id, object_key) DO UPDATE SET
       content_hash = excluded.content_hash,
       schema_version = excluded.schema_version,
       source_updated_at = NULL,
       generated_at = excluded.generated_at,
       deleted_at = NULL`,
  )
    .bind(
      id,
      USERS_INDEX_V2_ARTIFACT_TARGET_TYPE,
      USERS_INDEX_V2_ARTIFACT_TARGET_ID,
      objectKey,
      contentHash,
      USERS_INDEX_V2_STATIC_ARTIFACT_SCHEMA_VERSION,
      now,
    )
    .run();
  env.artifactHashCache?.set(objectKey, contentHash);
  throwIfAborted(signal);
}

async function putTrackedJson(
  env: Env,
  key: string,
  body: unknown,
  signal?: RebuildSignal,
): Promise<void> {
  throwIfAborted(signal);
  assertNoForbiddenPublicKeys(body);
  const serialized = JSON.stringify(body);
  const identical = await resolveIdenticalJsonArtifactPut(env, key, serialized);
  if (!identical) {
    await env.R2.put(key, serialized, {
      httpMetadata: {
        contentType: "application/json; charset=utf-8",
        cacheControl: staticR2CacheControl(STATIC_R2_MAX_AGE_SEC.usersIndex),
      },
    });
  }
  throwIfAborted(signal);
  await recordArtifact(env, key, serialized, signal);
}

async function reconcileTrackedArtifacts(
  env: Env,
  liveKeys: readonly string[],
  signal?: RebuildSignal,
): Promise<void> {
  throwIfAborted(signal);
  const live = new Set(liveKeys);
  const rows = await env.DB.prepare(
    `SELECT object_key
       FROM static_artifacts
      WHERE target_type = ? AND target_id = ? AND deleted_at IS NULL
      ORDER BY generated_at ASC
      LIMIT ?`,
  )
    .bind(
      USERS_INDEX_V2_ARTIFACT_TARGET_TYPE,
      USERS_INDEX_V2_ARTIFACT_TARGET_ID,
      USERS_INDEX_V2_CLEANUP_LIMIT,
    )
    .all<TrackedArtifactRow>();
  throwIfAborted(signal);

  const staleRows = (rows.results ?? []).filter((row) => !live.has(row.object_key));
  if (staleRows.length === 0) return;
  const now = Math.floor(Date.now() / 1000);
  for (const row of staleRows) {
    throwIfAborted(signal);
    await env.R2.delete(row.object_key);
    throwIfAborted(signal);
    await env.DB.prepare(
      `UPDATE static_artifacts
          SET deleted_at = ?
        WHERE target_type = ? AND target_id = ? AND object_key = ?
          AND deleted_at IS NULL`,
    )
      .bind(
        now,
        USERS_INDEX_V2_ARTIFACT_TARGET_TYPE,
        USERS_INDEX_V2_ARTIFACT_TARGET_ID,
        row.object_key,
      )
      .run();
  }
}

/**
 * v2 pages/search を先に完成させ、manifest を最後に更新する。
 * page/search は manifest と同じ generation を持ち、loader 側も一致を必須にする。
 * そのため途中失敗で既存キーが上書きされても旧manifestとは世代不一致となり、
 * legacy users/index.json へ安全にフォールバックできる。
 */
export async function rebuildUsersIndexV2Artifacts(
  env: Env,
  items: readonly UsersIndexV2SourceEntry[],
  generatedAt: number,
  signal?: RebuildSignal,
): Promise<{ liveKeys: string[]; objectCount: number }> {
  throwIfAborted(signal);
  const generation = await staticArtifactContentHash(generationMaterial(items));
  throwIfAborted(signal);
  const artifacts = buildUsersIndexV2Artifacts({
    items,
    generatedAt,
    generation,
  });
  const liveKeys: string[] = [];

  for (const page of artifacts.scorePages) {
    const key = usersIndexV2ScorePageObjectKey(page.page);
    assertArtifactSize(key, page, USERS_INDEX_V2_MAX_PAGE_BYTES);
    await putTrackedJson(env, key, page, signal);
    liveKeys.push(key);
  }

  assertArtifactSize(
    USERS_SEARCH_LITE_V1_OBJECT_KEY,
    artifacts.searchLite,
    USERS_SEARCH_LITE_V1_MAX_BYTES,
  );
  await putTrackedJson(
    env,
    USERS_SEARCH_LITE_V1_OBJECT_KEY,
    artifacts.searchLite,
    signal,
  );
  liveKeys.push(USERS_SEARCH_LITE_V1_OBJECT_KEY);

  // manifest is the commit point for this generation and must be written last.
  assertArtifactSize(
    USERS_INDEX_V2_MANIFEST_OBJECT_KEY,
    artifacts.manifest,
    USERS_INDEX_V2_MAX_MANIFEST_BYTES,
  );
  await putTrackedJson(
    env,
    USERS_INDEX_V2_MANIFEST_OBJECT_KEY,
    artifacts.manifest,
    signal,
  );
  liveKeys.push(USERS_INDEX_V2_MANIFEST_OBJECT_KEY);

  await reconcileTrackedArtifacts(env, liveKeys, signal);
  return { liveKeys, objectCount: liveKeys.length };
}
