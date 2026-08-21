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
  normalizeStaticUsersIndex,
  type StaticUsersIndexPayload,
} from "../../src/lib/publicData/staticUsersIndexCore.ts";
import { USERS_INDEX_OBJECT_KEY } from "../../src/lib/publicData/publicCreatorProjection.ts";
import {
  buildUsersIndexV2Artifacts,
  USERS_INDEX_V2_MANIFEST_OBJECT_KEY,
  USERS_INDEX_V2_MAX_MANIFEST_BYTES,
  USERS_INDEX_V2_MAX_PAGE_BYTES,
  USERS_SEARCH_LITE_V1_MAX_BYTES,
  usersIndexV2ArtifactByteLength,
  usersIndexV2PageObjectKey,
  usersIndexV2SearchLiteObjectKey,
  type UsersIndexV2Page,
  type UsersIndexV2SourceEntry,
} from "../../src/lib/publicData/staticUsersIndexV2Core.ts";

const USERS_INDEX_V2_ARTIFACT_TARGET_TYPE = "users_index_v2";
const USERS_INDEX_V2_ARTIFACT_TARGET_ID = "global";
const USERS_INDEX_V2_STATIC_ARTIFACT_SCHEMA_VERSION = 2;
/** generation-specific keyのpayload layout/sort規則を変える時は必ず上げる。 */
const USERS_INDEX_V2_GENERATION_LAYOUT_VERSION = 2;
/** R2 bulk delete は1000 keys/callまで。1回のrebuild cleanupはさらに小さく抑える。 */
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
  return JSON.stringify({
    layout_version: USERS_INDEX_V2_GENERATION_LAYOUT_VERSION,
    items: items.map((item) => ({
      x_id: item.x_id,
      x_name: item.x_name,
      icon_url: item.icon_url,
      personal_count: item.personal_count,
      collab_count: item.collab_count,
      total_works: item.total_works,
      sort_score: item.sort_score,
    })),
  });
}

function emptyLegacyGeneratedAt(payload: unknown): number | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const row = payload as Record<string, unknown>;
  if (!Array.isArray(row.items) || row.items.length !== 0) return null;
  const generatedAt = Number(row.generated_at);
  if (!Number.isFinite(generatedAt) || generatedAt < 0) return null;
  return Math.floor(generatedAt);
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

  const staleKeys = (rows.results ?? [])
    .map((row) => row.object_key)
    .filter((key) => !live.has(key));
  if (staleKeys.length === 0) return;

  // R2は最大1000 keysを1 callでdeleteできる。D1もjson_eachで1 UPDATEへ集約し、
  // generationが増えた後のcleanupで500回の逐次I/O/UPDATEを発生させない。
  await env.R2.delete(staleKeys);
  throwIfAborted(signal);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `UPDATE static_artifacts
        SET deleted_at = ?
      WHERE target_type = ?
        AND target_id = ?
        AND deleted_at IS NULL
        AND EXISTS (
          SELECT 1
          FROM json_each(?) AS stale_keys
          WHERE CAST(stale_keys.value AS TEXT) = static_artifacts.object_key
        )`,
  )
    .bind(
      now,
      USERS_INDEX_V2_ARTIFACT_TARGET_TYPE,
      USERS_INDEX_V2_ARTIFACT_TARGET_ID,
      JSON.stringify(staleKeys),
    )
    .run();
  for (const key of staleKeys) env.artifactHashCache?.set(key, null);
  throwIfAborted(signal);
}

async function invalidateUsersIndexV2Manifest(
  env: Env,
  signal?: RebuildSignal,
): Promise<void> {
  throwIfAborted(signal);
  await env.R2.delete(USERS_INDEX_V2_MANIFEST_OBJECT_KEY);
  throwIfAborted(signal);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `UPDATE static_artifacts
        SET deleted_at = ?
      WHERE target_type = ?
        AND target_id = ?
        AND object_key = ?
        AND deleted_at IS NULL`,
  )
    .bind(
      now,
      USERS_INDEX_V2_ARTIFACT_TARGET_TYPE,
      USERS_INDEX_V2_ARTIFACT_TARGET_ID,
      USERS_INDEX_V2_MANIFEST_OBJECT_KEY,
    )
    .run();
  env.artifactHashCache?.set(USERS_INDEX_V2_MANIFEST_OBJECT_KEY, null);
  throwIfAborted(signal);
}

function pageEntries(
  generation: string,
  pages: readonly UsersIndexV2Page[],
): Array<{ key: string; page: UsersIndexV2Page }> {
  return pages.map((page) => ({
    key: usersIndexV2PageObjectKey(generation, page.sort, page.page),
    page,
  }));
}

/**
 * score / works / name pageとsearchは generation 固有keyへ書き、
 * manifestだけを最後のcommit pointにする。新世代の途中失敗で旧世代objectを
 * 上書きしないため、manifest更新後だけ新世代へ切り替わる。
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
  const pages = [
    ...pageEntries(generation, artifacts.scorePages),
    ...pageEntries(generation, artifacts.worksPages),
    ...pageEntries(generation, artifacts.namePages),
  ];
  const searchKey = usersIndexV2SearchLiteObjectKey(generation);

  // 全size guardをR2 PUT前に評価する。guard失敗で半端な新世代を作らない。
  for (const entry of pages) {
    assertArtifactSize(entry.key, entry.page, USERS_INDEX_V2_MAX_PAGE_BYTES);
  }
  assertArtifactSize(
    searchKey,
    artifacts.searchLite,
    USERS_SEARCH_LITE_V1_MAX_BYTES,
  );
  assertArtifactSize(
    USERS_INDEX_V2_MANIFEST_OBJECT_KEY,
    artifacts.manifest,
    USERS_INDEX_V2_MAX_MANIFEST_BYTES,
  );

  const liveKeys: string[] = [];
  for (const entry of pages) {
    await putTrackedJson(env, entry.key, entry.page, signal);
    liveKeys.push(entry.key);
  }

  await putTrackedJson(env, searchKey, artifacts.searchLite, signal);
  liveKeys.push(searchKey);

  // manifest is the only commit point and must be written last.
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

async function rebuildUsersIndexV2FromLegacyArtifactStrict(
  env: Env,
  signal?: RebuildSignal,
): Promise<{ liveKeys: string[]; objectCount: number }> {
  throwIfAborted(signal);
  const object = await env.R2.get(USERS_INDEX_OBJECT_KEY);
  throwIfAborted(signal);
  if (!object) throw new Error("users_index_v2_requires_legacy_artifact");

  let payload: unknown;
  try {
    payload = await object.json();
  } catch {
    throw new Error("users_index_v2_legacy_artifact_invalid_json");
  }
  throwIfAborted(signal);

  // normalizeStaticUsersIndex intentionally rejects empty collections for the
  // public legacy loader. Rebuild generation itself must still support a valid
  // empty canonical artifact so the queue cannot become permanently stuck.
  const emptyGeneratedAt = emptyLegacyGeneratedAt(payload);
  if (emptyGeneratedAt != null) {
    return rebuildUsersIndexV2Artifacts(env, [], emptyGeneratedAt, signal);
  }

  const normalized = normalizeStaticUsersIndex(payload as StaticUsersIndexPayload);
  if (!normalized || normalized.generatedAt == null) {
    throw new Error("users_index_v2_legacy_artifact_invalid");
  }

  return rebuildUsersIndexV2Artifacts(
    env,
    normalized.items,
    normalized.generatedAt,
    signal,
  );
}

/**
 * v2 は canonical legacy users/index.json に対する任意の高速化成果物。
 * v2生成に失敗してもlegacyの正常生成まで失敗扱いにするとqueue retryが増幅するため、
 * manifestをR2から除去してlegacy fallbackを強制できた場合だけbest-effort成功扱いにする。
 * manifest無効化自体が失敗した場合は古いv2を正本化しないため例外を伝播して再試行する。
 */
export async function rebuildUsersIndexV2FromLegacyArtifact(
  env: Env,
  signal?: RebuildSignal,
): Promise<{ liveKeys: string[]; objectCount: number }> {
  try {
    return await rebuildUsersIndexV2FromLegacyArtifactStrict(env, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    try {
      await invalidateUsersIndexV2Manifest(env, signal);
    } catch (invalidationError) {
      console.error(
        JSON.stringify({
          service: "users-index-v2",
          result: "manifest_invalidation_failed",
          error_name:
            invalidationError instanceof Error
              ? invalidationError.name
              : "UnknownError",
        }),
      );
      throw error;
    }
    console.warn(
      JSON.stringify({
        service: "users-index-v2",
        result: "legacy_fallback",
        error_name: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    return { liveKeys: [], objectCount: 0 };
  }
}
