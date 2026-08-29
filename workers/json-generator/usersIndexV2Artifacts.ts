import { cancelR2BodyBestEffort } from "../../src/lib/r2Body.ts";
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
import {
  USERS_INDEX_MAX_OBJECT_BYTES,
  USERS_INDEX_OBJECT_KEY,
} from "../../src/lib/publicData/publicCreatorProjection.ts";
import {
  buildUsersIndexV2Artifacts,
  normalizeUsersIndexV2Manifest,
  USERS_INDEX_V2_MANIFEST_OBJECT_KEY,
  USERS_INDEX_V2_GENERATION_PREFIX,
  USERS_INDEX_V2_MAX_MANIFEST_BYTES,
  USERS_INDEX_V2_MAX_PAGE_BYTES,
  USERS_SEARCH_LITE_V1_MAX_BYTES,
  usersIndexV2ArtifactByteLength,
  usersIndexV2PageObjectKey,
  usersIndexV2SearchDirectoryObjectKey,
  usersIndexV2SearchManifestObjectKey,
  usersIndexV2SearchPostingPageObjectKey,
  usersIndexV2SearchLiteObjectKey,
  type UsersIndexV2Page,
  type UsersIndexV2SourceEntry,
} from "../../src/lib/publicData/staticUsersIndexV2Core.ts";
import { STATIC_SEARCH_POSTINGS_BUCKET_COUNT } from "../../src/lib/publicData/staticSearchPostingsCore.ts";

const USERS_INDEX_V2_ARTIFACT_TARGET_TYPE = "users_index_v2";
const USERS_INDEX_V2_ARTIFACT_TARGET_ID = "global";
const USERS_INDEX_V2_STATIC_ARTIFACT_SCHEMA_VERSION = 2;
/** generation-specific keyのpayload layout/sort規則を変える時は必ず上げる。 */
const USERS_INDEX_V2_GENERATION_LAYOUT_VERSION = 2;
/** R2 bulk delete は1000 keys/callまで。1回のrebuild cleanupはさらに小さく抑える。 */
const USERS_INDEX_V2_CLEANUP_LIMIT = 500;
const USERS_INDEX_V2_PURGE_SAFETY_SEC = 24 * 60 * 60;
// A same-generation skip is only safe when every immutable object can be
// checked.  Keep the verification below the Workers subrequest budget; large
// generations deliberately rebuild instead of guessing that R2 is complete.
// Workers Free allows 50 subrequests per invocation. Keep one manifest GET,
// one D1 tracking probe, and the bounded R2 HEAD checks below that limit;
// larger generations deliberately rebuild instead of issuing an unbounded
// verification burst.
const USERS_INDEX_V2_R2_VERIFY_LIMIT = 40;
/**
 * Tracking rows are sent as one JSON1 bind instead of seven binds per row.
 * Keep chunks bounded so JSON parsing and the serialized bind stay small while
 * avoiding one D1 statement per generated page.
 */
const USERS_INDEX_V2_ARTIFACT_RECORD_CHUNK_SIZE = 500;

type Env = {
  DB: D1Database;
  R2: R2Bucket;
  artifactHashCache?: ArtifactHashCache;
};

type RebuildSignal = AbortSignal | undefined;

type TrackedArtifactRow = {
  object_key: string;
};

type PendingArtifact = {
  objectKey: string;
  contentHash: string;
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

async function putTrackedJson(
  env: Env,
  key: string,
  body: unknown,
  signal?: RebuildSignal,
  options?: { deduplicate?: boolean },
): Promise<PendingArtifact> {
  throwIfAborted(signal);
  assertNoForbiddenPublicKeys(body);
  const serialized = JSON.stringify(body);
  const identical = options?.deduplicate === false
    ? null
    : await resolveIdenticalJsonArtifactPut(env, key, serialized);
  if (!identical) {
    await env.R2.put(key, serialized, {
      httpMetadata: {
        contentType: "application/json; charset=utf-8",
        cacheControl: staticR2CacheControl(STATIC_R2_MAX_AGE_SEC.usersIndex),
      },
    });
  }
  throwIfAborted(signal);
  const contentHash = await staticArtifactContentHash(serialized);
  throwIfAborted(signal);
  return { objectKey: key, contentHash };
}

async function recordArtifacts(
  env: Env,
  artifacts: readonly PendingArtifact[],
  signal?: RebuildSignal,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  for (
    let offset = 0;
    offset < artifacts.length;
    offset += USERS_INDEX_V2_ARTIFACT_RECORD_CHUNK_SIZE
  ) {
    throwIfAborted(signal);
    const chunk = artifacts.slice(
      offset,
      offset + USERS_INDEX_V2_ARTIFACT_RECORD_CHUNK_SIZE,
    );
    const artifactJson = JSON.stringify(chunk);
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
         'sta:users_index_v2:global:' || artifacts.object_key,
         'users_index_v2',
         'global',
         artifacts.object_key,
         artifacts.content_hash,
         ${USERS_INDEX_V2_STATIC_ARTIFACT_SCHEMA_VERSION},
         NULL,
         ?2,
         NULL
       FROM artifacts
       WHERE artifacts.object_key IS NOT NULL
       ON CONFLICT(target_type, target_id, object_key) DO UPDATE SET
         content_hash = excluded.content_hash,
         schema_version = excluded.schema_version,
         source_updated_at = NULL,
         generated_at = excluded.generated_at,
         deleted_at = NULL`,
    )
      .bind(artifactJson, now)
      .run();
    for (const artifact of chunk) {
      env.artifactHashCache?.set(artifact.objectKey, artifact.contentHash);
    }
    throwIfAborted(signal);
  }
}

type ManifestGenerationState =
  | { kind: "absent" }
  | { kind: "known"; generation: string; hasPostings: boolean }
  | { kind: "unknown" };

async function readCurrentManifestGeneration(
  env: Env,
): Promise<ManifestGenerationState> {
  try {
    const object = await env.R2.get(USERS_INDEX_V2_MANIFEST_OBJECT_KEY);
    if (!object) return { kind: "absent" };
    if (
      typeof object.size === "number" &&
      (!Number.isSafeInteger(object.size) ||
        object.size < 0 ||
        object.size > USERS_INDEX_V2_MAX_MANIFEST_BYTES)
    ) {
      await cancelR2BodyBestEffort(object);
      return { kind: "unknown" };
    }
    const payload = await object.json<unknown>();
    const manifest = normalizeUsersIndexV2Manifest(payload);
    return manifest
      ? {
          kind: "known",
          generation: manifest.generation,
          // The generation hash describes source/layout data, not optional
          // artifact families. A same-generation skip must still heal a
          // manifest written by a generator predating postings-v1.
          hasPostings:
            manifest.search_backend === "postings-v1" &&
            manifest.search_bucket_count === STATIC_SEARCH_POSTINGS_BUCKET_COUNT,
        }
      : { kind: "unknown" };
  } catch (error) {
    console.warn(
      JSON.stringify({
        service: "users-index-v2",
        result: "chunk_cleanup_manifest_read_failed",
        error_name: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    return { kind: "unknown" };
  }
}

async function canSkipSameGeneration(
  env: Env,
  generation: string,
  liveKeys: readonly string[],
  signal?: RebuildSignal,
): Promise<boolean> {
  throwIfAborted(signal);
  if (liveKeys.length > USERS_INDEX_V2_R2_VERIFY_LIMIT) return false;
  const manifest = await readCurrentManifestGeneration(env);
  if (
    manifest.kind !== "known" ||
    manifest.generation !== generation ||
    !manifest.hasPostings
  ) {
    return false;
  }
  const result = await env.DB.prepare(
    `SELECT COUNT(*) AS count
       FROM static_artifacts
      WHERE target_type = ?
        AND target_id = ?
        AND deleted_at IS NULL
        AND EXISTS (
          SELECT 1
          FROM json_each(?) AS live_keys
          WHERE CAST(live_keys.value AS TEXT) = static_artifacts.object_key
        )`,
  )
    .bind(
      USERS_INDEX_V2_ARTIFACT_TARGET_TYPE,
      USERS_INDEX_V2_ARTIFACT_TARGET_ID,
      JSON.stringify(liveKeys),
    )
    .first<{ count: number | string }>();
  throwIfAborted(signal);
  const count = Number(result?.count ?? 0);
  if (!Number.isSafeInteger(count) || count !== liveKeys.length) return false;

  // Tracking is not proof that the object still exists: an operator or an
  // eventual R2 repair may have removed an immutable page after the D1 row
  // was written.  Never skip in that state; the normal rebuild path heals it.
  if (typeof env.R2.head !== "function") return false;
  for (const key of liveKeys) {
    throwIfAborted(signal);
    try {
      if (!(await env.R2.head(key))) return false;
    } catch {
      throwIfAborted(signal);
      return false;
    }
  }
  return true;
}

/**
 * Remove a failed chunk only when the current manifest cannot point at it.
 * A retry can generate the same immutable key as a published generation; in
 * that case deleting the chunk would break currently visible data.
 */
async function cleanupFailedArtifactChunk(
  env: Env,
  chunk: readonly PendingArtifact[],
  generation: string,
): Promise<void> {
  const keys = [...new Set(chunk.map((artifact) => artifact.objectKey))];
  if (keys.length === 0) return;
  const manifest = await readCurrentManifestGeneration(env);
  if (manifest.kind === "unknown") return;
  if (manifest.kind === "known" && manifest.generation === generation) return;
  try {
    await env.R2.delete(keys);
  } catch (error) {
    console.warn(
      JSON.stringify({
        service: "users-index-v2",
        result: "chunk_cleanup_failed",
        key_count: keys.length,
        error_name: error instanceof Error ? error.name : "UnknownError",
      }),
    );
  }
}

async function reconcileTrackedArtifacts(
  env: Env,
  liveKeys: readonly string[],
  signal?: RebuildSignal,
): Promise<{ deleted: number; hasMore: boolean }> {
  throwIfAborted(signal);
  const currentManifest = await readCurrentManifestGeneration(env);
  // A transient manifest read failure cannot prove which generation is live.
  // Keep the rows for the next bounded continuation rather than deleting a
  // key that the published manifest may still reference.
  if (currentManifest.kind === "unknown") {
    return { deleted: 0, hasMore: true };
  }
  const protectedGeneration =
    currentManifest.kind === "known" ? currentManifest.generation : null;
  const protectedPagePrefix = protectedGeneration
    ? `${USERS_INDEX_V2_GENERATION_PREFIX}/${protectedGeneration}/%`
    : null;
  const protectedPostingPrefix = protectedGeneration
    ? `search-postings.v1/users-${protectedGeneration}/%`
    : null;
  const protectionSql = protectedGeneration
    ? `
        AND object_key <> ?
        AND object_key NOT LIKE ?
        AND object_key NOT LIKE ?`
    : "";
  const rows = await env.DB.prepare(
    `SELECT object_key
       FROM static_artifacts
      WHERE target_type = ? AND target_id = ? AND deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM json_each(?) AS live_keys
          WHERE CAST(live_keys.value AS TEXT) = static_artifacts.object_key
        )
      ${protectionSql}
      ORDER BY generated_at ASC
      LIMIT ?`,
  )
    .bind(
      USERS_INDEX_V2_ARTIFACT_TARGET_TYPE,
      USERS_INDEX_V2_ARTIFACT_TARGET_ID,
      JSON.stringify(liveKeys),
      ...(protectedGeneration
        ? [
            USERS_INDEX_V2_MANIFEST_OBJECT_KEY,
            protectedPagePrefix!,
            protectedPostingPrefix!,
            USERS_INDEX_V2_CLEANUP_LIMIT,
          ]
        : [USERS_INDEX_V2_CLEANUP_LIMIT]),
    )
    .all<TrackedArtifactRow>();
  throwIfAborted(signal);

  const staleKeys = (rows.results ?? []).map((row) => row.object_key);
  if (staleKeys.length === 0) {
    return {
      deleted: 0,
      hasMore: (rows.results ?? []).length >= USERS_INDEX_V2_CLEANUP_LIMIT,
    };
  }

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
        )
      ${protectionSql}`,
  )
    .bind(
      now,
      USERS_INDEX_V2_ARTIFACT_TARGET_TYPE,
      USERS_INDEX_V2_ARTIFACT_TARGET_ID,
      JSON.stringify(staleKeys),
      ...(protectedGeneration
        ? [
            USERS_INDEX_V2_MANIFEST_OBJECT_KEY,
            protectedPagePrefix!,
            protectedPostingPrefix!,
          ]
        : []),
    )
    .run();
  for (const key of staleKeys) env.artifactHashCache?.set(key, null);
  throwIfAborted(signal);
  return {
    deleted: staleKeys.length,
    hasMore: (rows.results ?? []).length >= USERS_INDEX_V2_CLEANUP_LIMIT,
  };
}

async function purgeDeletedArtifacts(
  env: Env,
  liveKeys: readonly string[],
  signal?: RebuildSignal,
): Promise<{ deleted: number; hasMore: boolean }> {
  throwIfAborted(signal);
  const currentManifest = await readCurrentManifestGeneration(env);
  if (currentManifest.kind === "unknown") {
    return { deleted: 0, hasMore: true };
  }
  const cutoff = Math.floor(Date.now() / 1000) - USERS_INDEX_V2_PURGE_SAFETY_SEC;
  const protectedGeneration =
    currentManifest.kind === "known" ? currentManifest.generation : null;
  const protectedPagePrefix = protectedGeneration
    ? `${USERS_INDEX_V2_GENERATION_PREFIX}/${protectedGeneration}/%`
    : null;
  const protectedPostingPrefix = protectedGeneration
    ? `search-postings.v1/users-${protectedGeneration}/%`
    : null;
  const protectionSql = protectedGeneration
    ? `
        AND object_key <> ?
        AND object_key NOT LIKE ?
        AND object_key NOT LIKE ?`
    : "";
  const rows = await env.DB.prepare(
    `SELECT object_key
       FROM static_artifacts
      WHERE target_type = ?
        AND target_id = ?
        AND deleted_at IS NOT NULL
        AND deleted_at < ?
        AND NOT EXISTS (
          SELECT 1
          FROM json_each(?) AS live_keys
          WHERE CAST(live_keys.value AS TEXT) = static_artifacts.object_key
        )
      ${protectionSql}
      ORDER BY deleted_at ASC
      LIMIT ?`,
  )
    .bind(
      USERS_INDEX_V2_ARTIFACT_TARGET_TYPE,
      USERS_INDEX_V2_ARTIFACT_TARGET_ID,
      cutoff,
      JSON.stringify(liveKeys),
      ...(protectedGeneration
        ? [
            USERS_INDEX_V2_MANIFEST_OBJECT_KEY,
            protectedPagePrefix!,
            protectedPostingPrefix!,
            USERS_INDEX_V2_CLEANUP_LIMIT,
          ]
        : [USERS_INDEX_V2_CLEANUP_LIMIT]),
    )
    .all<TrackedArtifactRow>();
  throwIfAborted(signal);
  const keys = (rows.results ?? []).map((row) => row.object_key).filter(Boolean);
  if (keys.length === 0) {
    return {
      deleted: 0,
      hasMore: (rows.results ?? []).length >= USERS_INDEX_V2_CLEANUP_LIMIT,
    };
  }
  await env.DB.prepare(
    `DELETE FROM static_artifacts
      WHERE target_type = ?
        AND target_id = ?
        AND EXISTS (
          SELECT 1
          FROM json_each(?) AS purge_keys
          WHERE CAST(purge_keys.value AS TEXT) = static_artifacts.object_key
        )
        AND deleted_at IS NOT NULL
        AND deleted_at < ?
      ${protectionSql}`,
  )
    .bind(
      USERS_INDEX_V2_ARTIFACT_TARGET_TYPE,
      USERS_INDEX_V2_ARTIFACT_TARGET_ID,
      JSON.stringify(keys),
      cutoff,
      ...(protectedGeneration
        ? [
            USERS_INDEX_V2_MANIFEST_OBJECT_KEY,
            protectedPagePrefix!,
            protectedPostingPrefix!,
          ]
        : []),
    )
    .run();
  throwIfAborted(signal);
  for (const key of keys) env.artifactHashCache?.set(key, null);
  return {
    deleted: keys.length,
    hasMore: (rows.results ?? []).length >= USERS_INDEX_V2_CLEANUP_LIMIT,
  };
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

function searchPostingEntries(
  generation: string,
  artifacts: ReturnType<typeof buildUsersIndexV2Artifacts>["searchPostings"],
): Array<{ key: string; value: unknown }> {
  return [
    {
      key: usersIndexV2SearchManifestObjectKey(generation),
      value: artifacts.manifest,
    },
    ...artifacts.directories.map(({ bucket, directory }) => ({
      key: usersIndexV2SearchDirectoryObjectKey(generation, bucket),
      value: directory,
    })),
    ...artifacts.pages.map(({ bucket, page }) => ({
      key: usersIndexV2SearchPostingPageObjectKey(generation, bucket, page.page),
      value: page,
    })),
  ];
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
  options?: { forceRepair?: boolean },
): Promise<{ liveKeys: string[]; objectCount: number; hasMore: boolean; skipped: boolean }> {
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
  const searchEntries = searchPostingEntries(generation, artifacts.searchPostings);
  const expectedLiveKeys = [
    ...pages.map((entry) => entry.key),
    searchKey,
    ...searchEntries.map((entry) => entry.key),
    USERS_INDEX_V2_MANIFEST_OBJECT_KEY,
  ];

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
  for (const entry of searchEntries) {
    assertArtifactSize(
      entry.key,
      entry.value,
      entry.key.includes("/manifest.json")
        ? USERS_INDEX_V2_MAX_MANIFEST_BYTES
        : USERS_INDEX_V2_MAX_PAGE_BYTES,
    );
  }

  if (
    !options?.forceRepair &&
    (await canSkipSameGeneration(env, generation, expectedLiveKeys, signal))
  ) {
    const cleanup = await reconcileTrackedArtifacts(env, expectedLiveKeys, signal);
    const purge = await purgeDeletedArtifacts(env, expectedLiveKeys, signal);
    console.info(
      JSON.stringify({
        service: "users-index-v2",
        result: "generation_same_skip",
        generation,
        gc_deleted: cleanup.deleted + purge.deleted,
        gc_has_more: cleanup.hasMore || purge.hasMore,
      }),
    );
    return {
      liveKeys: expectedLiveKeys,
      objectCount: expectedLiveKeys.length,
      hasMore: cleanup.hasMore || purge.hasMore,
      skipped: true,
    };
  }

  const liveKeys: string[] = [];
  const pendingArtifacts: PendingArtifact[] = [];
  const flushPendingArtifacts = async (force = false): Promise<void> => {
    while (
      pendingArtifacts.length >= USERS_INDEX_V2_ARTIFACT_RECORD_CHUNK_SIZE ||
      (force && pendingArtifacts.length > 0)
    ) {
      const chunk = pendingArtifacts.splice(
        0,
        USERS_INDEX_V2_ARTIFACT_RECORD_CHUNK_SIZE,
      );
      try {
        await recordArtifacts(env, chunk, signal);
      } catch (error) {
        await cleanupFailedArtifactChunk(env, chunk, generation);
        throw error;
      }
    }
  };

  for (const entry of pages) {
    // Generation-specific keys are immutable by construction.  Avoid one D1
    // hash lookup per page; the tracking rows are persisted in bounded chunks
    // before the manifest write below.
    try {
      pendingArtifacts.push(
        await putTrackedJson(env, entry.key, entry.page, signal, {
          deduplicate: false,
        }),
      );
    } catch (error) {
      // A page failure can happen before the current bounded chunk reaches
      // D1. Remove those successful-but-untracked R2 objects so a retry does
      // not leave an orphaned generation behind.
      if (pendingArtifacts.length > 0) {
        const orphaned = pendingArtifacts.splice(0);
        await cleanupFailedArtifactChunk(
          env,
          [...orphaned, { objectKey: entry.key, contentHash: "" }],
          generation,
        );
      } else {
        await cleanupFailedArtifactChunk(
          env,
          [{ objectKey: entry.key, contentHash: "" }],
          generation,
        );
      }
      throw error;
    }
    liveKeys.push(entry.key);
    await flushPendingArtifacts();
  }

  try {
    pendingArtifacts.push(
      await putTrackedJson(env, searchKey, artifacts.searchLite, signal, {
        deduplicate: false,
      }),
    );
  } catch (error) {
    if (pendingArtifacts.length > 0) {
      const orphaned = pendingArtifacts.splice(0);
      await cleanupFailedArtifactChunk(
        env,
        [...orphaned, { objectKey: searchKey, contentHash: "" }],
        generation,
      );
    } else {
      await cleanupFailedArtifactChunk(
        env,
        [{ objectKey: searchKey, contentHash: "" }],
        generation,
      );
    }
    throw error;
  }
  liveKeys.push(searchKey);

  for (const entry of searchEntries) {
    try {
      pendingArtifacts.push(
        await putTrackedJson(env, entry.key, entry.value, signal, {
          deduplicate: false,
        }),
      );
    } catch (error) {
      const orphaned = pendingArtifacts.splice(0);
      await cleanupFailedArtifactChunk(
        env,
        [...orphaned, { objectKey: entry.key, contentHash: "" }],
        generation,
      );
      throw error;
    }
    liveKeys.push(entry.key);
    await flushPendingArtifacts();
  }

  // Track every page/search object before publishing the manifest. A failed
  // page or search PUT can still leave an earlier chunk in R2, but that chunk
  // is already represented in static_artifacts for the next reconciliation.
  await flushPendingArtifacts(true);

  // manifest is the only commit point and must be written last.
  const manifestArtifact = await putTrackedJson(
    env,
    USERS_INDEX_V2_MANIFEST_OBJECT_KEY,
    artifacts.manifest,
    signal,
  );
  liveKeys.push(USERS_INDEX_V2_MANIFEST_OBJECT_KEY);

  // Track the manifest immediately after its R2 commit. If this write fails,
  // the caller invalidates the manifest so no untracked commit point remains.
  await recordArtifacts(env, [manifestArtifact], signal);
  const cleanup = await reconcileTrackedArtifacts(env, liveKeys, signal);
  const purge = await purgeDeletedArtifacts(env, liveKeys, signal);
  return {
    liveKeys,
    objectCount: liveKeys.length,
    hasMore: cleanup.hasMore || purge.hasMore,
    skipped: false,
  };
}

async function rebuildUsersIndexV2FromLegacyArtifactStrict(
  env: Env,
  signal?: RebuildSignal,
  options?: { forceRepair?: boolean },
): Promise<{ liveKeys: string[]; objectCount: number; hasMore: boolean; skipped: boolean }> {
  throwIfAborted(signal);
  const object = await env.R2.get(USERS_INDEX_OBJECT_KEY);
  if (signal?.aborted) {
    await cancelR2BodyBestEffort(object);
    throwIfAborted(signal);
  }
  if (!object) throw new Error("users_index_v2_requires_legacy_artifact");
  if (
    typeof object.size === "number" &&
    (!Number.isSafeInteger(object.size) ||
      object.size < 0 ||
      object.size > USERS_INDEX_MAX_OBJECT_BYTES)
  ) {
    await cancelR2BodyBestEffort(object);
    throw new Error("users_index_v2_legacy_artifact_too_large");
  }

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
    return rebuildUsersIndexV2Artifacts(env, [], emptyGeneratedAt, signal, options);
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
    options,
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
  options?: { forceRepair?: boolean },
): Promise<{ liveKeys: string[]; objectCount: number; hasMore: boolean; skipped: boolean }> {
  try {
    return await rebuildUsersIndexV2FromLegacyArtifactStrict(env, signal, options);
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
    return { liveKeys: [], objectCount: 0, hasMore: false, skipped: false };
  }
}
