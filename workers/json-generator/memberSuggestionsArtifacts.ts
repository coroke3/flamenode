import { assertNoForbiddenPublicKeys } from "./sanitize.ts";
import {
  resolveIdenticalJsonArtifactPut,
  staticArtifactContentHash,
  type ArtifactHashCache,
} from "./r2Dedup.ts";
import { publishMemberSuggestionsV2BestEffort } from "./memberSuggestionsV2Artifacts.ts";
import {
  assertMemberSuggestionsRowLimit,
  buildMemberSuggestionArtifacts,
  buildMemberSuggestionItems,
  memberSuggestionsGenerationMaterial,
  MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY,
  memberSuggestionsIndexObjectKey,
  MEMBER_SUGGESTIONS_MAX_INDEX_BYTES,
  MEMBER_SUGGESTIONS_MAX_MANIFEST_BYTES,
  safeGenerationForObjectKey,
  type MemberSuggestionItem,
  type MemberSuggestionSourceEntry,
} from "../../src/lib/video/memberSuggestionsCore.ts";

const MEMBER_SUGGESTIONS_ARTIFACT_TARGET_TYPE = "member_suggestions";
const MEMBER_SUGGESTIONS_ARTIFACT_TARGET_ID = "global";
const MEMBER_SUGGESTIONS_STATIC_ARTIFACT_SCHEMA_VERSION = 1;
/** R2 bulk delete は1000 keys/callまで。stale cleanupはさらに小さく抑える。 */
const MEMBER_SUGGESTIONS_CLEANUP_LIMIT = 100;

/**
 * 全source readに明示的な上限を設ける。上限超過時はpartial indexを静かに
 * publishせず、generation build自体を失敗させて旧世代（旧manifest）を維持する。
 * LIMIT値は許容最大+1件のsentinel。ちょうど上限件数を誤って超過扱いしない。
 */
const SOURCE_LIMIT_X_USERS = 20_001;
const SOURCE_LIMIT_ALIASES = 50_001;
const SOURCE_LIMIT_VIDEO_HISTORY = 20_001;

type Env = {
  DB: D1Database;
  R2: R2Bucket;
  artifactHashCache?: ArtifactHashCache;
};

type RebuildSignal = AbortSignal | undefined;
type TrackedArtifactRow = { object_key: string };

function throwIfAborted(signal: RebuildSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new Error(
    signal.reason === undefined ? "static rebuild aborted" : String(signal.reason),
  );
}

function assertArtifactSize(key: string, value: unknown, maxBytes: number): void {
  const byteLength = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (byteLength > maxBytes) {
    throw new Error(`${key} exceeds size limit (${byteLength} > ${maxBytes} bytes)`);
  }
}

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

async function loadSourceEntries(
  env: Env,
  signal: RebuildSignal,
): Promise<MemberSuggestionSourceEntry[]> {
  throwIfAborted(signal);

  const profileResult = await env.DB.prepare(
    `SELECT id, x_name, approval_status
       FROM x_users
      ORDER BY id ASC
      LIMIT ?`,
  )
    .bind(SOURCE_LIMIT_X_USERS)
    .all<{ id?: string; x_name?: string | null; approval_status?: string | null }>();
  throwIfAborted(signal);
  const profileRows = profileResult.results ?? [];
  if (profileRows.length >= SOURCE_LIMIT_X_USERS) {
    throw new Error("member_suggestions_x_users_limit_exceeded");
  }

  const aliasResult = await env.DB.prepare(
    `SELECT x_user_id, alias_x_id
       FROM x_user_aliases
      ORDER BY x_user_id ASC, alias_x_id ASC
      LIMIT ?`,
  )
    .bind(SOURCE_LIMIT_ALIASES)
    .all<{ x_user_id?: string; alias_x_id?: string }>();
  throwIfAborted(signal);
  const aliasRows = aliasResult.results ?? [];
  if (aliasRows.length >= SOURCE_LIMIT_ALIASES) {
    throw new Error("member_suggestions_alias_limit_exceeded");
  }

  const creatorResult = await env.DB.prepare(
    `SELECT creator_x_user_id, creator_display_name, updated_at
       FROM videos
      WHERE creator_x_user_id IS NOT NULL
      ORDER BY updated_at DESC, id DESC
      LIMIT ?`,
  )
    .bind(SOURCE_LIMIT_VIDEO_HISTORY)
    .all<{
      creator_x_user_id?: string | null;
      creator_display_name?: string | null;
      updated_at?: number | null;
    }>();
  throwIfAborted(signal);
  const creatorRows = creatorResult.results ?? [];
  if (creatorRows.length >= SOURCE_LIMIT_VIDEO_HISTORY) {
    throw new Error("member_suggestions_video_history_limit_exceeded");
  }

  const memberResult = await env.DB.prepare(
    `SELECT video_members.x_user_id AS x_user_id,
            video_members.name AS name,
            videos.updated_at AS updated_at
       FROM video_members
       INNER JOIN videos ON videos.id = video_members.video_id
      WHERE video_members.x_user_id IS NOT NULL
      ORDER BY videos.updated_at DESC, videos.id DESC, video_members.id DESC
      LIMIT ?`,
  )
    .bind(SOURCE_LIMIT_VIDEO_HISTORY)
    .all<{ x_user_id?: string | null; name?: string | null; updated_at?: number | null }>();
  throwIfAborted(signal);
  const memberRows = memberResult.results ?? [];
  if (memberRows.length >= SOURCE_LIMIT_VIDEO_HISTORY) {
    throw new Error("member_suggestions_member_history_limit_exceeded");
  }

  const entries: MemberSuggestionSourceEntry[] = [];
  for (const row of profileRows) {
    const id = textOrNull(row.id);
    if (!id) continue;
    entries.push({
      x_user_id: id,
      name: textOrNull(row.x_name),
      isProfileName: true,
      approvalStatus: textOrNull(row.approval_status),
    });
  }
  for (const row of aliasRows) {
    const ownerId = textOrNull(row.x_user_id);
    const alias = textOrNull(row.alias_x_id);
    if (!ownerId || !alias) continue;
    entries.push({ x_user_id: ownerId, xAliases: [alias] });
  }
  for (const row of creatorRows) {
    const id = textOrNull(row.creator_x_user_id);
    if (!id) continue;
    entries.push({
      x_user_id: id,
      nameAliases: [textOrNull(row.creator_display_name) ?? ""].filter(Boolean),
      occurrenceCount: 1,
      lastSeenAt:
        typeof row.updated_at === "number" && Number.isFinite(row.updated_at)
          ? Math.floor(row.updated_at)
          : null,
    });
  }
  for (const row of memberRows) {
    const id = textOrNull(row.x_user_id);
    if (!id) continue;
    entries.push({
      x_user_id: id,
      nameAliases: [textOrNull(row.name) ?? ""].filter(Boolean),
      occurrenceCount: 1,
      lastSeenAt:
        typeof row.updated_at === "number" && Number.isFinite(row.updated_at)
          ? Math.floor(row.updated_at)
          : null,
    });
  }
  return entries;
}

async function recordArtifacts(
  env: Env,
  artifacts: ReadonlyArray<{ objectKey: string; contentHash: string }>,
  generatedAt: number,
  signal: RebuildSignal,
): Promise<void> {
  throwIfAborted(signal);
  for (const artifact of artifacts) {
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
        `${MEMBER_SUGGESTIONS_ARTIFACT_TARGET_TYPE}:${MEMBER_SUGGESTIONS_ARTIFACT_TARGET_ID}:${artifact.objectKey}`,
        MEMBER_SUGGESTIONS_ARTIFACT_TARGET_TYPE,
        MEMBER_SUGGESTIONS_ARTIFACT_TARGET_ID,
        artifact.objectKey,
        artifact.contentHash,
        MEMBER_SUGGESTIONS_STATIC_ARTIFACT_SCHEMA_VERSION,
        generatedAt,
      )
      .run();
    env.artifactHashCache?.set(artifact.objectKey, artifact.contentHash);
    throwIfAborted(signal);
  }
}

/** stale generation cleanupはbounded。D1更新はjson_each 1文に集約する。 */
async function reconcileTrackedArtifacts(
  env: Env,
  liveKeys: readonly string[],
  signal: RebuildSignal,
): Promise<void> {
  throwIfAborted(signal);
  const rows = await env.DB.prepare(
    `SELECT object_key
       FROM static_artifacts
      WHERE target_type = ? AND target_id = ? AND deleted_at IS NULL
      ORDER BY generated_at ASC
      LIMIT ?`,
  )
    .bind(
      MEMBER_SUGGESTIONS_ARTIFACT_TARGET_TYPE,
      MEMBER_SUGGESTIONS_ARTIFACT_TARGET_ID,
      MEMBER_SUGGESTIONS_CLEANUP_LIMIT,
    )
    .all<TrackedArtifactRow>();
  throwIfAborted(signal);

  const live = new Set(liveKeys);
  const staleKeys = (rows.results ?? [])
    .map((row) => row.object_key)
    .filter((key) => !live.has(key));
  if (staleKeys.length === 0) return;

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
          SELECT 1 FROM json_each(?) AS stale_keys
          WHERE CAST(stale_keys.value AS TEXT) = static_artifacts.object_key
        )`,
  )
    .bind(
      now,
      MEMBER_SUGGESTIONS_ARTIFACT_TARGET_TYPE,
      MEMBER_SUGGESTIONS_ARTIFACT_TARGET_ID,
      JSON.stringify(staleKeys),
    )
    .run();
  for (const key of staleKeys) env.artifactHashCache?.set(key, null);
  throwIfAborted(signal);
}

type MemberSuggestionsTrackedArtifact = {
  objectKey: string;
  contentHash: string;
  wrote: boolean;
};

async function cleanupWrittenArtifacts(
  env: Env,
  artifacts: readonly MemberSuggestionsTrackedArtifact[],
  preserveObjectKeys: ReadonlySet<string> = new Set<string>(),
): Promise<void> {
  const keys = [
    ...new Set(
      artifacts
        .filter(
          (artifact) =>
            artifact.wrote && !preserveObjectKeys.has(artifact.objectKey),
        )
        .map((artifact) => artifact.objectKey),
    ),
  ];
  if (keys.length === 0) return;
  try {
    await env.R2.delete(keys);
  } catch (error) {
    console.warn(
      JSON.stringify({
        service: "member-suggestions",
        result: "tracking_cleanup_r2_failed",
        key_count: keys.length,
        error_name: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    return;
  }
  try {
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `UPDATE static_artifacts
          SET deleted_at = ?
        WHERE target_type = ? AND target_id = ? AND deleted_at IS NULL
          AND EXISTS (
            SELECT 1
              FROM json_each(?) AS removed_keys
             WHERE CAST(removed_keys.value AS TEXT) = static_artifacts.object_key
          )`,
    )
      .bind(
        now,
        MEMBER_SUGGESTIONS_ARTIFACT_TARGET_TYPE,
        MEMBER_SUGGESTIONS_ARTIFACT_TARGET_ID,
        JSON.stringify(keys),
      )
      .run();
    for (const key of keys) env.artifactHashCache?.set(key, null);
  } catch (error) {
    console.warn(
      JSON.stringify({
        service: "member-suggestions",
        result: "tracking_cleanup_d1_failed",
        key_count: keys.length,
        error_name: error instanceof Error ? error.name : "UnknownError",
      }),
    );
  }
}

async function putTrackedJson(
  env: Env,
  key: string,
  body: unknown,
  signal: RebuildSignal,
  options?: { deduplicate?: boolean },
): Promise<MemberSuggestionsTrackedArtifact> {
  throwIfAborted(signal);
  assertNoForbiddenPublicKeys(body);
  const serialized = JSON.stringify(body);
  const contentHash = await staticArtifactContentHash(serialized);
  throwIfAborted(signal);
  const identical =
    options?.deduplicate === false
      ? null
      : await resolveIdenticalJsonArtifactPut(env, key, serialized);
  if (!identical) {
    await env.R2.put(key, serialized, {
      httpMetadata: {
        contentType: "application/json; charset=utf-8",
        cacheControl: "private, max-age=0, must-revalidate",
      },
    });
  }
  return { objectKey: key, contentHash, wrote: !identical };
}

type PreviousManifestBody = string | null;

async function readPreviousManifest(
  env: Env,
  signal: RebuildSignal,
): Promise<PreviousManifestBody> {
  throwIfAborted(signal);
  const object = await env.R2.get(MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY);
  if (!object) return null;
  if (
    typeof object.size === "number" &&
    object.size > MEMBER_SUGGESTIONS_MAX_MANIFEST_BYTES
  ) {
    return null;
  }
  const body = await object.text();
  throwIfAborted(signal);
  return body;
}

async function restorePreviousManifest(
  env: Env,
  body: PreviousManifestBody,
): Promise<void> {
  try {
    if (body === null) {
      await env.R2.delete(MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY);
      return;
    }
    await env.R2.put(MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY, body, {
      httpMetadata: {
        contentType: "application/json; charset=utf-8",
        cacheControl: "private, max-age=0, must-revalidate",
      },
    });
  } catch (error) {
    console.warn(
      JSON.stringify({
        service: "member-suggestions",
        result: "manifest_restore_failed",
        error_name: error instanceof Error ? error.name : "UnknownError",
      }),
    );
  }
}

export type MemberSuggestionsRebuildResult = {
  generation: string;
  itemCount: number;
  liveKeys: string[];
};

/**
 * member_suggestions targetの本体。V1をcanonicalとしてcommitした後、同じitemsから
 * bounded V2 postingsをbest-effortで生成する。V2障害はV1成功を巻き戻さない。
 */
export async function rebuildMemberSuggestions(
  env: Env,
  signal?: RebuildSignal,
): Promise<MemberSuggestionsRebuildResult> {
  throwIfAborted(signal);
  const sourceEntries = await loadSourceEntries(env, signal);
  const items: MemberSuggestionItem[] = buildMemberSuggestionItems(sourceEntries);
  assertMemberSuggestionsRowLimit(items);
  throwIfAborted(signal);

  const generatedAt = Math.floor(Date.now() / 1000);
  const generation = safeGeneration(
    await staticArtifactContentHash(memberSuggestionsGenerationMaterial(items)),
  );
  throwIfAborted(signal);
  const { manifest, index } = buildMemberSuggestionArtifacts({
    items,
    generatedAt,
    generation,
  });

  const indexKey = memberSuggestionsIndexObjectKey(generation);
  assertArtifactSize(indexKey, index, MEMBER_SUGGESTIONS_MAX_INDEX_BYTES);
  assertArtifactSize(
    MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY,
    manifest,
    MEMBER_SUGGESTIONS_MAX_MANIFEST_BYTES,
  );

  const committed: MemberSuggestionsTrackedArtifact[] = [];
  let previousManifest: PreviousManifestBody | undefined;
  let manifestArtifact: MemberSuggestionsTrackedArtifact | undefined;
  let manifestPutCompleted = false;
  try {
    // manifestはcommit point。generation-specific indexは公開前のimmutable準備成果物なので、
    // rollback時にも削除しない。既存manifestが同世代indexを参照している修復ケースや、
    // 次回同世代retryの再利用を壊さず、不要な孤立indexは後続reconcileで回収する。
    previousManifest = await readPreviousManifest(env, signal);

    const indexArtifact = await putTrackedJson(env, indexKey, index, signal, {
      deduplicate: true,
    });
    committed.push(indexArtifact);
    await recordArtifacts(env, [indexArtifact], generatedAt, signal);

    manifestArtifact = await putTrackedJson(
      env,
      MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY,
      manifest,
      signal,
      { deduplicate: true },
    );
    manifestPutCompleted = true;
    committed.push(manifestArtifact);
    await recordArtifacts(env, [manifestArtifact], generatedAt, signal);
  } catch (error) {
    await cleanupWrittenArtifacts(env, committed, new Set([indexKey]));
    if (
      previousManifest !== undefined &&
      (previousManifest !== null
        ? manifestArtifact?.wrote === true || !manifestPutCompleted
        : manifestArtifact === undefined && !manifestPutCompleted)
    ) {
      await restorePreviousManifest(env, previousManifest);
    }
    throw error;
  }

  try {
    await publishMemberSuggestionsV2BestEffort({
      bucket: env.R2,
      items,
      generatedAt,
      generation,
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn(
      JSON.stringify({
        service: "member-suggestions-v2",
        result: "v1_fallback_publish_error",
        error_name: error instanceof Error ? error.name : "UnknownError",
      }),
    );
  }

  const liveKeys = committed.map((artifact) => artifact.objectKey);
  await reconcileTrackedArtifacts(env, liveKeys, signal);
  return { generation, itemCount: items.length, liveKeys };
}

function safeGeneration(generation: string): string {
  try {
    return safeGenerationForObjectKey(generation);
  } catch {
    throw new Error("invalid member suggestions generation");
  }
}
