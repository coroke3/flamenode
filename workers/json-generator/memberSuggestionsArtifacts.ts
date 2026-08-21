import { assertNoForbiddenPublicKeys } from "./sanitize.ts";
import {
  resolveIdenticalJsonArtifactPut,
  staticArtifactContentHash,
  type ArtifactHashCache,
} from "./r2Dedup.ts";
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
 */
const SOURCE_LIMIT_X_USERS = 20_001; // MAX_ROWS + 1（超過検出用）
const SOURCE_LIMIT_ALIASES = 50_000;
const SOURCE_LIMIT_VIDEO_HISTORY = 20_000;

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
  throw new Error(signal.reason === undefined ? "static rebuild aborted" : String(signal.reason));
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

  // 1. x_users の現在プロフィール（表示名の正本・approval status）。
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

  // 2. x_user_aliases。
  const aliasResult = await env.DB.prepare(
    `SELECT x_user_id, alias_x_id
       FROM x_user_aliases
      LIMIT ?`,
  )
    .bind(SOURCE_LIMIT_ALIASES)
    .all<{ x_user_id?: string; alias_x_id?: string }>();
  throwIfAborted(signal);
  const aliasRows = aliasResult.results ?? [];
  if (aliasRows.length >= SOURCE_LIMIT_ALIASES) {
    throw new Error("member_suggestions_alias_limit_exceeded");
  }

  // 3. 動画クリエイター履歴（新しい順）。
  const creatorResult = await env.DB.prepare(
    `SELECT creator_x_user_id, creator_display_name, updated_at
       FROM videos
      WHERE creator_x_user_id IS NOT NULL
      ORDER BY updated_at DESC
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

  // 4. メンバー履歴（動画更新日の新しい順）。
  const memberResult = await env.DB.prepare(
    `SELECT video_members.x_user_id AS x_user_id,
            video_members.name AS name,
            videos.updated_at AS updated_at
       FROM video_members
       INNER JOIN videos ON videos.id = video_members.video_id
      WHERE video_members.x_user_id IS NOT NULL
      ORDER BY videos.updated_at DESC
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

/** stale generation cleanupはbounded。manifestが指す現行keyは必ずlive扱い。 */
async function reconcileTrackedArtifacts(
  env: Env,
  liveKeys: readonly string[],
  signal: RebuildSignal,
): Promise<void> {
  throwIfAborted(signal);
  const now = Math.floor(Date.now() / 1000);
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
  for (const key of staleKeys) {
    await env.DB.prepare(
      `UPDATE static_artifacts
          SET deleted_at = ?
        WHERE target_type = ? AND target_id = ? AND object_key = ?
          AND deleted_at IS NULL`,
    )
      .bind(now, MEMBER_SUGGESTIONS_ARTIFACT_TARGET_TYPE, MEMBER_SUGGESTIONS_ARTIFACT_TARGET_ID, key)
      .run();
    env.artifactHashCache?.set(key, null);
    throwIfAborted(signal);
  }
}

async function putTrackedJson(
  env: Env,
  key: string,
  body: unknown,
  signal: RebuildSignal,
  options?: { deduplicate?: boolean },
): Promise<{ objectKey: string; contentHash: string }> {
  throwIfAborted(signal);
  assertNoForbiddenPublicKeys(body);
  const serialized = JSON.stringify(body);
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
  throwIfAborted(signal);
  const contentHash = await staticArtifactContentHash(serialized);
  throwIfAborted(signal);
  return { objectKey: key, contentHash };
}

export type MemberSuggestionsRebuildResult = {
  generation: string;
  itemCount: number;
  liveKeys: string[];
};

/**
 * member_suggestions targetの本体。generation-specific indexを書いてから
 * manifest（唯一のcommit point）を最後に書く。途中失敗しても旧manifestは壊れない。
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
  // generation hashは内容依存（generated_atを除いた本文）。同一内容なら同一世代。
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
  // 全size guardをR2 PUT前に評価する。guard失敗で半端な新世代を作らない。
  assertArtifactSize(indexKey, index, MEMBER_SUGGESTIONS_MAX_INDEX_BYTES);
  assertArtifactSize(MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY, manifest, MEMBER_SUGGESTIONS_MAX_MANIFEST_BYTES);

  // generation objectを書いてからmanifest（唯一のcommit point）を最後に書く。
  // 途中失敗しても旧manifestは壊れない。書けた不変オブジェクトはtrackingされない
  // ためreconcileの削除対象にもならない（次回成功時に追跡される）。
  const committed: Array<{ objectKey: string; contentHash: string }> = [];
  committed.push(await putTrackedJson(env, indexKey, index, signal, { deduplicate: true }));
  committed.push(
    await putTrackedJson(env, MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY, manifest, signal, {
      deduplicate: true,
    }),
  );
  await recordArtifacts(env, committed, generatedAt, signal);

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
