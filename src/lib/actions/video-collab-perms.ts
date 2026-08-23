"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDatabase } from "@/lib/cloudflare";
import { writeGuard } from "@/lib/auth/writeGuard";
import {
  canEditVideo,
  canUseEventPrivilegeModeForVideo,
  type CanEditVideoPrivilegeMode,
} from "@/lib/auth/ownership";
import { videoMembers, videos, xUserAccountLinks, xUsers } from "@/lib/db/schema";
import { MAX_COLLABORATOR_PERMISSION_BATCH, MAX_VIDEO_MEMBERS } from "@/lib/video/atomicLimits";
import { generateId } from "@/lib/utils/id";
import { normalizeXId } from "@/lib/utils/xid";
import {
  buildKnownRecipientNotificationBatch,
  buildKnownRecipientNotificationBulkBatch,
} from "@/lib/notifications/enqueue";
import { buildVideoEditPermissionGrantedNotification } from "@/lib/notifications/templates/video";
import { expectedRowCondition } from "@/lib/audit/adapters";
import { mutateWithAudit } from "@/lib/audit/mutate";
import { runPostCommitBestEffort } from "@/lib/audit/postCommit";
import type { WriteAuditLogInput } from "@/lib/audit/types";
import { createTraceId } from "@/lib/observability/flowTrace";
import { buildStaticRebuildQueueBatch } from "@/lib/staticRebuild/enqueue";
import { memberSuggestionsTarget } from "@/lib/staticRebuild/hooks";
import {
  getAuthUserIdsForXUser,
  getLinkedXUserIdsForAuthUser,
  isAuthUserLinkedToXUser,
} from "@/lib/auth/xIdentity";

export interface VideoCollabResult {
  ok: boolean;
  message?: string;
}

async function revalidateVideoCollabPathsBestEffort(videoId: string): Promise<void> {
  await runPostCommitBestEffort(
    { flow: "video_collab_permissions", traceId: createTraceId() },
    [
      {
        name: "revalidate_video_collab_paths",
        run: async () => {
          revalidatePath(`/dashboard/edit/${videoId}`);
        },
      },
    ],
  );
}

const upsertSchema = z.object({
  video_id: z.string().trim().min(1).max(64),
  x_user_id: z.string().trim().max(32).optional().transform((value) => normalizeXId(value ?? "")),
  user_id: z.string().trim().max(128).optional().nullable(),
  display_name: z.string().trim().min(1).max(80),
  can_edit: z
    .union([z.literal("1"), z.literal("0"), z.literal("true"), z.literal("false")])
    .optional()
    .transform((value) => value === "1" || value === "true" || value === undefined),
  notify: z.union([z.literal("1"), z.literal("0")]).optional().transform((value) => value === "1"),
});

/**
 * TSV権限列の反映は permission intent として分離し、members_json 経由では絶対に
 * can_edit を保存させない。このbatch actionだけが video.permissions 権限の再検証の
 * 上で差分 UPDATE / INSERT / DELETE を行う。バッチ件数上限は
 * MAX_COLLABORATOR_PERMISSION_BATCH (atomicLimits)。
 */
const permissionIntentSchema = z.object({
  x_user_id: z.string().trim().min(1).max(64).transform((value) => normalizeXId(value)),
  display_name: z.string().trim().min(1).max(80),
  intent: z.union([z.literal("on"), z.literal("off")]),
});

const permissionBatchSchema = z.object({
  video_id: z.string().trim().min(1).max(64),
  edit_privilege_mode: z.string().trim().max(16).optional(),
  notify: z.boolean().optional().default(true),
  intents: z
    .array(permissionIntentSchema)
    .min(1)
    .max(MAX_COLLABORATOR_PERMISSION_BATCH),
});

export interface VideoCollabPermissionBatchResult extends VideoCollabResult {
  granted?: string[];
  revoked?: string[];
  unchanged?: number;
}

type DB = NonNullable<ReturnType<typeof getDatabase>>;
type VideoMemberRow = typeof videoMembers.$inferSelect;

async function resolvePrivilegeMode(
  db: DB,
  rawMode: string,
  user: { id: string; role?: string | null },
  video: Pick<
    typeof videos.$inferSelect,
    | "id"
    | "primary_event_id"
    | "creator_x_user_id"
    | "submitted_by_user_id"
    | "visibility_status"
  >,
): Promise<CanEditVideoPrivilegeMode> {
  if (rawMode === "admin" && user.role === "admin") return "admin";
  if (rawMode === "event") {
    const canUseEvent = await canUseEventPrivilegeModeForVideo({
      db,
      user,
      video,
    });
    if (canUseEvent) return "event";
  }
  return "normal";
}

type EditableVideo = Pick<
  typeof videos.$inferSelect,
  | "id"
  | "title"
  | "primary_event_id"
  | "creator_x_user_id"
  | "submitted_by_user_id"
  | "visibility_status"
> & { privilegeMode: CanEditVideoPrivilegeMode };

/** video取得と video.permissions 権限検証を single / batch action で共有する。 */
async function loadEditableVideoForPermissions(
  db: DB,
  actor: { id: string; role?: string | null },
  videoId: string,
  privilegeModeRaw: string,
): Promise<EditableVideo | null> {
  const row = (
    await db
      .select({
        id: videos.id,
        title: videos.title,
        primary_event_id: videos.primary_event_id,
        creator_x_user_id: videos.creator_x_user_id,
        submitted_by_user_id: videos.submitted_by_user_id,
        visibility_status: videos.visibility_status,
      })
      .from(videos)
      .where(eq(videos.id, videoId))
      .limit(1)
  )[0];
  if (!row) return null;
  const video = {
    ...row,
    submitted_by_user_id: row.submitted_by_user_id ?? "",
  };

  const requested = privilegeModeRaw.trim();
  const requestedMode = await resolvePrivilegeMode(db, requested, actor, video);
  const requestedAllowed = await canEditVideo({
    db,
    user: actor,
    video,
    requiredKey: "video.permissions",
    privilegeMode: requestedMode,
  });
  if (requestedAllowed) return { ...video, privilegeMode: requestedMode };

  // 古いcallerやTSV一括入力は privilege mode を渡していないことがある。
  // 明示modeがない場合だけ、normal→admin→event の順でServer側から安全に補完する。
  if (requested) return null;
  if (actor.role === "admin") {
    const adminAllowed = await canEditVideo({
      db,
      user: actor,
      video,
      requiredKey: "video.permissions",
      privilegeMode: "admin",
    });
    if (adminAllowed) return { ...video, privilegeMode: "admin" };
  }
  const canUseEvent = await canUseEventPrivilegeModeForVideo({ db, user: actor, video });
  if (canUseEvent) {
    const eventAllowed = await canEditVideo({
      db,
      user: actor,
      video,
      requiredKey: "video.permissions",
      privilegeMode: "event",
    });
    if (eventAllowed) return { ...video, privilegeMode: "event" };
  }
  return null;
}

async function loadEditableVideo(
  db: DB,
  user: { id: string; role?: string | null },
  videoId: string,
  formData: FormData,
) {
  const raw = String(formData.get("edit_privilege_mode") ?? "").trim();
  const loaded = await loadEditableVideoForPermissions(db, user, videoId, raw);
  if (!loaded) return null;
  return loaded;
}

async function resolveSubjectXUserId(
  db: DB,
  xUserId: string | null,
  authUserId: string | null,
): Promise<{ ok: true; xUserId: string } | { ok: false; message: string }> {
  if (xUserId) {
    if (authUserId && !(await isAuthUserLinkedToXUser(db, authUserId, xUserId))) {
      return { ok: false, message: "指定した認証ユーザーはその X ID に紐づいていません。" };
    }
    return { ok: true, xUserId };
  }
  if (!authUserId) return { ok: false, message: "共同編集者の X ID が必要です。" };
  const linked = await getLinkedXUserIdsForAuthUser(db, authUserId, { approvedOnly: true });
  if (linked.length === 0) {
    return { ok: false, message: "指定した認証ユーザーに承認済み X ID がありません。" };
  }
  if (linked.length > 1) {
    return { ok: false, message: "複数の X ID が紐づいているため、共同編集者の X ID を明示してください。" };
  }
  return { ok: true, xUserId: linked[0] };
}

async function findMemberRowForXUser(db: DB, videoId: string, xUserId: string) {
  return (
    await db
      .select()
      .from(videoMembers)
      .where(
        and(
          eq(videoMembers.video_id, videoId),
          isNotNull(videoMembers.x_user_id),
          sql`lower(${videoMembers.x_user_id}) = ${xUserId}`,
        )!,
      )
      .limit(1)
  )[0] ?? null;
}

function permissionSnapshotRow(row: VideoMemberRow) {
  return {
    id: row.id,
    video_id: row.video_id,
    x_user_id: row.x_user_id,
    name: row.name,
    role: row.role,
    comment: row.comment,
    order_index: row.order_index,
    can_edit: row.can_edit,
    is_public_member: row.is_public_member,
    edit_granted_by_auth_user_id: row.edit_granted_by_auth_user_id,
    edit_granted_at: row.edit_granted_at,
    edit_updated_at: row.edit_updated_at,
  };
}

function sortPermissionRows(rows: readonly VideoMemberRow[]): VideoMemberRow[] {
  return [...rows].sort((left, right) => left.id.localeCompare(right.id));
}

function buildPermissionSetGuardSql(
  videoId: string,
  xids: readonly string[],
  expectedRows: readonly VideoMemberRow[],
) {
  const xidsPayload = JSON.stringify([...xids].sort());
  const expectedPayload = JSON.stringify(
    sortPermissionRows(expectedRows).map(permissionSnapshotRow),
  );
  return sql`
    SELECT CASE
      WHEN (
        SELECT COALESCE(json_group_array(json(row_json)), json('[]'))
        FROM (
          SELECT json_object(
            'id', id,
            'video_id', video_id,
            'x_user_id', x_user_id,
            'name', name,
            'role', role,
            'comment', comment,
            'order_index', order_index,
            'can_edit', can_edit,
            'is_public_member', is_public_member,
            'edit_granted_by_auth_user_id', edit_granted_by_auth_user_id,
            'edit_granted_at', edit_granted_at,
            'edit_updated_at', edit_updated_at
          ) AS row_json
          FROM video_members
          WHERE video_id = ${videoId}
            AND x_user_id IS NOT NULL
            AND lower(x_user_id) IN (
              SELECT lower(CAST(value AS TEXT)) FROM json_each(${xidsPayload})
            )
          ORDER BY id ASC
        )
      ) = json(${expectedPayload})
      THEN 1
      ELSE json_extract('video-permission-set-conflict', '$')
    END
  `;
}

function buildMemberCountGuardSql(videoId: string, expectedCount: number) {
  return sql`
    SELECT CASE
      WHEN (SELECT COUNT(*) FROM video_members WHERE video_id = ${videoId}) = ${expectedCount}
      THEN 1
      ELSE json_extract('video-member-count-conflict', '$')
    END
  `;
}

function buildXUsersBulkInsertSql(rows: readonly (typeof xUsers.$inferInsert)[]) {
  const payload = JSON.stringify(rows);
  return sql`
    INSERT INTO x_users (
      id,
      x_name,
      icon_url,
      profile_text,
      portfolio_contact,
      youtube_channel_url,
      other_social_links,
      creative_start_date,
      approval_status
    )
    SELECT
      json_extract(value, '$.id'),
      json_extract(value, '$.x_name'),
      json_extract(value, '$.icon_url'),
      json_extract(value, '$.profile_text'),
      json_extract(value, '$.portfolio_contact'),
      json_extract(value, '$.youtube_channel_url'),
      json_extract(value, '$.other_social_links'),
      json_extract(value, '$.creative_start_date'),
      json_extract(value, '$.approval_status')
    FROM json_each(${payload})
  `;
}

function buildMemberPermissionBulkUpdateSql(rows: readonly VideoMemberRow[]) {
  const payload = JSON.stringify(rows.map(permissionSnapshotRow));
  return sql`
    WITH patches AS (
      SELECT
        json_extract(value, '$.id') AS id,
        json_extract(value, '$.name') AS name,
        json_extract(value, '$.can_edit') AS can_edit,
        json_extract(value, '$.edit_granted_by_auth_user_id') AS edit_granted_by_auth_user_id,
        json_extract(value, '$.edit_granted_at') AS edit_granted_at,
        json_extract(value, '$.edit_updated_at') AS edit_updated_at
      FROM json_each(${payload})
    )
    UPDATE video_members
    SET
      name = (SELECT name FROM patches WHERE patches.id = video_members.id),
      can_edit = (SELECT can_edit FROM patches WHERE patches.id = video_members.id),
      edit_granted_by_auth_user_id = (
        SELECT edit_granted_by_auth_user_id FROM patches WHERE patches.id = video_members.id
      ),
      edit_granted_at = (
        SELECT edit_granted_at FROM patches WHERE patches.id = video_members.id
      ),
      edit_updated_at = (
        SELECT edit_updated_at FROM patches WHERE patches.id = video_members.id
      )
    WHERE id IN (SELECT id FROM patches)
  `;
}

function buildHiddenMemberBulkInsertSql(rows: readonly VideoMemberRow[]) {
  const payload = JSON.stringify(rows.map(permissionSnapshotRow));
  return sql`
    INSERT INTO video_members (
      id,
      video_id,
      x_user_id,
      name,
      role,
      comment,
      order_index,
      can_edit,
      is_public_member,
      edit_granted_by_auth_user_id,
      edit_granted_at,
      edit_updated_at
    )
    SELECT
      json_extract(value, '$.id'),
      json_extract(value, '$.video_id'),
      json_extract(value, '$.x_user_id'),
      json_extract(value, '$.name'),
      json_extract(value, '$.role'),
      json_extract(value, '$.comment'),
      json_extract(value, '$.order_index'),
      json_extract(value, '$.can_edit'),
      json_extract(value, '$.is_public_member'),
      json_extract(value, '$.edit_granted_by_auth_user_id'),
      json_extract(value, '$.edit_granted_at'),
      json_extract(value, '$.edit_updated_at')
    FROM json_each(${payload})
  `;
}

function buildHiddenMemberBulkDeleteSql(videoId: string, ids: readonly string[]) {
  const payload = JSON.stringify(ids);
  return sql`
    DELETE FROM video_members
    WHERE video_id = ${videoId}
      AND is_public_member = 0
      AND id IN (
        SELECT CAST(value AS TEXT) FROM json_each(${payload})
      )
  `;
}

export async function upsertVideoCollaborator(formData: FormData): Promise<VideoCollabResult> {
  const guard = await writeGuard({ feature: "edit_video" });
  if (!guard.ok) return { ok: false, message: guard.message };
  const actor = { id: guard.user.id, role: guard.user.role ?? null };
  const parsed = upsertSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "入力エラー" };
  }

  let db: ReturnType<typeof getDatabase>;
  try {
    db = getDatabase();
  } catch (error) {
    unstable_rethrow(error);
    console.error("[video-collab-perms] database binding unavailable", error);
    return { ok: false, message: "DB に接続できません。" };
  }
  if (!db) return { ok: false, message: "DB に接続できません。" };
  try {
  const video = await loadEditableVideo(db, actor, parsed.data.video_id, formData);
  if (!video) return { ok: false, message: "対象作品が見つからない、または権限がありません。" };
  const privilegeMode = video.privilegeMode;

  const resolved = await resolveSubjectXUserId(
    db,
    parsed.data.x_user_id || null,
    parsed.data.user_id?.trim() || null,
  );
  if (!resolved.ok) return { ok: false, message: resolved.message };
  const xUserId = resolved.xUserId;
  const now = Math.floor(Date.now() / 1000);
  const canEdit = parsed.data.can_edit ? 1 : 0;
  const existing = await findMemberRowForXUser(db, video.id, xUserId);

  const statements: BatchItem<"sqlite">[] = [];
  const expected: Array<number | null> = [];
  const audits: WriteAuditLogInput[] = [];
  const existingX = (await db.select().from(xUsers).where(eq(xUsers.id, xUserId)).limit(1))[0];
  if (!existingX) {
    const xAfter: typeof xUsers.$inferInsert = {
      id: xUserId,
      x_name: parsed.data.display_name || `@${xUserId}`,
      icon_url: null,
      profile_text: null,
      portfolio_contact: null,
      youtube_channel_url: null,
      other_social_links: null,
      creative_start_date: null,
      approval_status: "pending",
    };
    statements.push(db.insert(xUsers).values(xAfter));
    expected.push(1);
    audits.push({
      table_name: "x_users",
      target_id: xUserId,
      operation: "CREATE",
      before: null,
      after: xAfter,
      actor_user_id: actor.id,
      context: "video_collab_permissions",
      reason: "共同編集者X IDをpending作成",
      retention_class: "long_audit",
      strict: true,
    });
  }

  const wasCanEdit = existing?.can_edit === 1;
  let memberAfter: typeof videoMembers.$inferSelect;
  if (existing) {
    const patch = {
      name: parsed.data.display_name,
      can_edit: canEdit,
      edit_granted_by_auth_user_id:
        canEdit === 1 ? actor.id : existing.edit_granted_by_auth_user_id,
      edit_granted_at:
        canEdit === 1 && existing.edit_granted_at == null ? now : existing.edit_granted_at,
      edit_updated_at: now,
    };
    memberAfter = { ...existing, ...patch };
    statements.push(
      db
        .update(videoMembers)
        .set(patch)
        .where(
          and(
            eq(videoMembers.id, existing.id),
            expectedRowCondition({ expectedCurrent: { ...existing } }),
          )!,
        ),
    );
    expected.push(1);
    audits.push({
      table_name: "video_members",
      target_id: existing.id,
      operation: "UPDATE",
      before: { ...existing },
      after: memberAfter,
      actor_user_id: actor.id,
      context: "video_collab_permissions",
      reason: `共同編集権限を更新 privilege:${privilegeMode}`,
      retention_class: "long_audit",
      strict: true,
    });
  } else {
    memberAfter = {
      id: generateId("vm"),
      video_id: video.id,
      x_user_id: xUserId,
      name: parsed.data.display_name,
      role: null,
      comment: null,
      order_index: 9999,
      can_edit: canEdit,
      is_public_member: 0,
      edit_granted_by_auth_user_id: canEdit === 1 ? actor.id : null,
      edit_granted_at: canEdit === 1 ? now : null,
      edit_updated_at: now,
    };
    statements.push(db.insert(videoMembers).values(memberAfter));
    expected.push(1);
    audits.push({
      table_name: "video_members",
      target_id: memberAfter.id,
      operation: "CREATE",
      before: null,
      after: memberAfter,
      actor_user_id: actor.id,
      context: "video_collab_permissions",
      reason: `共同編集権限を作成 privilege:${privilegeMode}`,
      retention_class: "long_audit",
      strict: true,
    });
  }

  let notificationWakeSource: "manage" | undefined;
  if (canEdit === 1 && !wasCanEdit && parsed.data.notify) {
    const recipientIds = (await getAuthUserIdsForXUser(db, xUserId)).filter((id) => id !== actor.id);
    if (recipientIds.length > 0) {
      const notification = await buildKnownRecipientNotificationBatch(
        db,
        recipientIds.map((recipientUserId) => ({
          recipientUserId,
          type: "video_edit_permission_granted",
          dedupeKey: `video_edit_permission_granted:${video.id}:x:${xUserId}:user:${recipientUserId}`,
          payload: buildVideoEditPermissionGrantedNotification({ videoId: video.id, videoTitle: video.title }),
          eventId: video.primary_event_id,
        })),
      );
      statements.push(...notification.statements);
      expected.push(...notification.expectedChanges);
      notificationWakeSource = "manage";
    }
  }

  const queue = await buildStaticRebuildQueueBatch(db, [
    memberSuggestionsTarget("video_collab_permissions"),
  ]);

  try {
    await mutateWithAudit(db, {
      mutationStatements: [...statements, ...queue.statements],
      expectedMutationChanges: [...expected, ...queue.expectedChanges],
      audits,
      notificationWakeSource,
    });
  } catch (error) {
    unstable_rethrow(error);
    console.error("[video-collab-perms] atomic mutation failed", error);
    return { ok: false, message: "共同編集権限・通知・監査の更新に失敗しました。" };
  }
  await revalidateVideoCollabPathsBestEffort(video.id);
  return { ok: true, message: canEdit ? "作品編集への参加を付与しました。" : "作品編集への参加を無効化しました。" };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[video-collab-perms] collaborator action failed", error);
    return { ok: false, message: "合作権限の読込・更新に失敗しました。" };
  }
}

export async function deleteVideoCollaborator(formData: FormData): Promise<VideoCollabResult> {
  const guard = await writeGuard({ feature: "edit_video" });
  if (!guard.ok) return { ok: false, message: guard.message };
  const actor = { id: guard.user.id, role: guard.user.role ?? null };
  const videoId = String(formData.get("video_id") ?? "").trim();
  const xUserId = normalizeXId(String(formData.get("x_user_id") ?? ""));
  if (!videoId || !xUserId) return { ok: false, message: "video_id と X ID が必要です。" };

  let db: ReturnType<typeof getDatabase>;
  try {
    db = getDatabase();
  } catch (error) {
    unstable_rethrow(error);
    console.error("[video-collab-perms] database binding unavailable", error);
    return { ok: false, message: "DB に接続できません。" };
  }
  if (!db) return { ok: false, message: "DB に接続できません。" };
  try {
  const video = await loadEditableVideo(db, actor, videoId, formData);
  if (!video) return { ok: false, message: "対象作品が見つからない、または権限がありません。" };
  const privilegeMode = video.privilegeMode;
  const existing = await findMemberRowForXUser(db, video.id, xUserId);
  if (!existing) return { ok: true, message: "該当する権限行はすでにありません。" };

  const now = Math.floor(Date.now() / 1000);
  const deleteRow = existing.is_public_member === 0;
  const after = deleteRow ? null : { ...existing, can_edit: 0, edit_updated_at: now };
  const statement = deleteRow
    ? db
        .delete(videoMembers)
        .where(
          and(
            eq(videoMembers.id, existing.id),
            expectedRowCondition({ expectedCurrent: { ...existing } }),
          )!,
        )
    : db
        .update(videoMembers)
        .set({ can_edit: 0, edit_updated_at: now })
        .where(
          and(
            eq(videoMembers.id, existing.id),
            expectedRowCondition({ expectedCurrent: { ...existing } }),
          )!,
        );
  try {
    await mutateWithAudit(db, {
      mutationStatements: [statement],
      expectedMutationChanges: 1,
      audits: [
        {
          table_name: "video_members",
          target_id: existing.id,
          operation: deleteRow ? "DELETE" : "UPDATE",
          before: existing,
          after,
          actor_user_id: actor.id,
          context: "video_collab_permissions",
          reason: `共同編集権限を解除 privilege:${privilegeMode}`,
          retention_class: "long_audit",
          strict: true,
        },
      ],
    });
  } catch (error) {
    unstable_rethrow(error);
    console.error("[video-collab-perms] revoke failed", error);
    return { ok: false, message: "共同編集権限の解除に失敗しました。" };
  }
  await revalidateVideoCollabPathsBestEffort(video.id);
  return { ok: true, message: "作品編集への参加を解除しました。" };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[video-collab-perms] collaborator revoke failed", error);
    return { ok: false, message: "合作権限の読込・解除に失敗しました。" };
  }
}

/**
 * TSV権限列の一括反映。
 * 対象100人をJSON1で集合処理し、1人ごとのD1 statement / audit / recipient lookupを
 * 作らない。対象member集合のCAS guardで同時更新をfail-closedにする。
 */
export async function applyVideoCollaboratorPermissionsBatch(
  input: unknown,
): Promise<VideoCollabPermissionBatchResult> {
  const guard = await writeGuard({ feature: "edit_video" });
  if (!guard.ok) return { ok: false, message: guard.message };
  const actor = { id: guard.user.id, role: guard.user.role ?? null };

  const parsed = permissionBatchSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "入力エラー" };
  }

  const intents = new Map<string, { displayName: string; intent: "on" | "off" }>();
  for (const item of parsed.data.intents) {
    const xid = normalizeXId(item.x_user_id);
    if (!xid) continue;
    if (!intents.has(xid)) {
      intents.set(xid, { displayName: item.display_name.trim(), intent: item.intent });
    }
  }
  const xids = Array.from(intents.keys());
  if (xids.length === 0) {
    return { ok: true, granted: [], revoked: [], unchanged: 0 };
  }

  let db: ReturnType<typeof getDatabase>;
  try {
    db = getDatabase();
  } catch (error) {
    unstable_rethrow(error);
    console.error("[video-collab-perms] database binding unavailable", error);
    return { ok: false, message: "DB に接続できません。" };
  }
  if (!db) return { ok: false, message: "DB に接続できません。" };

  try {
    const video = await loadEditableVideoForPermissions(
      db,
      actor,
      parsed.data.video_id,
      parsed.data.edit_privilege_mode ?? "",
    );
    if (!video) {
      return { ok: false, message: "対象作品が見つからない、または権限がありません。" };
    }
    const privilegeMode = video.privilegeMode;
    const xidsPayload = JSON.stringify(xids);

    const existingRows = await db
      .select()
      .from(videoMembers)
      .where(
        and(
          eq(videoMembers.video_id, video.id),
          isNotNull(videoMembers.x_user_id),
          sql`lower(${videoMembers.x_user_id}) IN (
            SELECT lower(CAST(value AS TEXT)) FROM json_each(${xidsPayload})
          )`,
        )!,
      )
      .limit(MAX_VIDEO_MEMBERS + xids.length);

    const rowsByXid = new Map<string, VideoMemberRow[]>();
    for (const row of existingRows) {
      const key = normalizeXId(row.x_user_id ?? "");
      if (!key) continue;
      const current = rowsByXid.get(key) ?? [];
      current.push(row);
      rowsByXid.set(key, current);
    }
    for (const rows of rowsByXid.values()) {
      rows.sort(
        (left, right) =>
          right.is_public_member - left.is_public_member ||
          right.can_edit - left.can_edit ||
          left.id.localeCompare(right.id),
      );
    }

    const currentCountRow = await db
      .select({ count: sql<number>`count(*)` })
      .from(videoMembers)
      .where(eq(videoMembers.video_id, video.id));
    const currentMemberCount = Number(currentCountRow[0]?.count ?? 0);
    let nextMemberCount = currentMemberCount;

    const grantXids = xids.filter((xid) => intents.get(xid)?.intent === "on");
    const existingProfiles = grantXids.length === 0
      ? []
      : await db
          .select({ id: xUsers.id })
          .from(xUsers)
          .where(sql`lower(${xUsers.id}) IN (
            SELECT lower(CAST(value AS TEXT))
            FROM json_each(${JSON.stringify(grantXids)})
          )`)
          .limit(grantXids.length + 1);
    const existingProfileIds = new Set(existingProfiles.map((row) => normalizeXId(row.id)));

    const now = Math.floor(Date.now() / 1000);
    const updateRows: VideoMemberRow[] = [];
    const insertHiddenRows: VideoMemberRow[] = [];
    const deleteHiddenIds: string[] = [];
    const newXUsers: Array<typeof xUsers.$inferInsert> = [];
    const grantedNames: string[] = [];
    const revokedNames: string[] = [];
    const notifyXids: string[] = [];
    let unchanged = 0;

    for (const [xid, intentInfo] of intents) {
      const label = `${intentInfo.displayName} @${xid}`;
      const rowsForXid = rowsByXid.get(xid) ?? [];
      const publicRows = rowsForXid.filter((row) => row.is_public_member === 1);
      const hiddenRows = rowsForXid.filter((row) => row.is_public_member === 0);
      const hadEffectiveEdit = rowsForXid.some((row) => row.can_edit === 1);

      if (intentInfo.intent === "on") {
        if (!existingProfileIds.has(xid)) {
          newXUsers.push({
            id: xid,
            x_name: intentInfo.displayName || `@${xid}`,
            icon_url: null,
            profile_text: null,
            portfolio_contact: null,
            youtube_channel_url: null,
            other_social_links: null,
            creative_start_date: null,
            approval_status: "pending",
          });
          existingProfileIds.add(xid);
        }

        if (publicRows.length > 0) {
          const target = publicRows[0]!;
          const permissionSource = [...rowsForXid].sort(
            (left, right) =>
              right.can_edit - left.can_edit ||
              Number(right.edit_updated_at ?? 0) - Number(left.edit_updated_at ?? 0) ||
              left.id.localeCompare(right.id),
          )[0]!;
          if (target.can_edit !== 1) {
            updateRows.push({
              ...target,
              name: intentInfo.displayName || target.name,
              can_edit: 1,
              edit_granted_by_auth_user_id:
                permissionSource.can_edit === 1
                  ? permissionSource.edit_granted_by_auth_user_id
                  : actor.id,
              edit_granted_at:
                permissionSource.can_edit === 1 && permissionSource.edit_granted_at != null
                  ? permissionSource.edit_granted_at
                  : now,
              edit_updated_at: now,
            });
          }
          for (const hidden of hiddenRows) {
            deleteHiddenIds.push(hidden.id);
            nextMemberCount -= 1;
          }
        } else if (hiddenRows.length > 0) {
          const target = hiddenRows[0]!;
          if (target.can_edit !== 1) {
            updateRows.push({
              ...target,
              name: intentInfo.displayName || target.name,
              can_edit: 1,
              edit_granted_by_auth_user_id: actor.id,
              edit_granted_at: target.edit_granted_at ?? now,
              edit_updated_at: now,
            });
          }
          for (const duplicate of hiddenRows.slice(1)) {
            deleteHiddenIds.push(duplicate.id);
            nextMemberCount -= 1;
          }
        } else {
          insertHiddenRows.push({
            id: generateId("vm"),
            video_id: video.id,
            x_user_id: xid,
            name: intentInfo.displayName || `@${xid}`,
            role: null,
            comment: null,
            order_index: 9999,
            can_edit: 1,
            is_public_member: 0,
            edit_granted_by_auth_user_id: actor.id,
            edit_granted_at: now,
            edit_updated_at: now,
          });
          nextMemberCount += 1;
        }

        if (hadEffectiveEdit) {
          unchanged += 1;
        } else {
          grantedNames.push(label);
          if (parsed.data.notify) notifyXids.push(xid);
        }
        continue;
      }

      for (const row of publicRows) {
        if (row.can_edit !== 1) continue;
        updateRows.push({ ...row, can_edit: 0, edit_updated_at: now });
      }
      for (const hidden of hiddenRows) {
        deleteHiddenIds.push(hidden.id);
        nextMemberCount -= 1;
      }
      if (hadEffectiveEdit) revokedNames.push(label);
      else unchanged += 1;
    }

    // ON/OFFが同一batchに混在しても入力順で上限判定が変わらないよう、
    // 全intentのnet row countを計算してから判定する。
    if (insertHiddenRows.length > 0 && nextMemberCount > MAX_VIDEO_MEMBERS) {
      return {
        ok: false,
        message: `合作メンバーは最大${MAX_VIDEO_MEMBERS}人です。これ以上編集権を付与できません。`,
      };
    }

    if (
      updateRows.length === 0 &&
      insertHiddenRows.length === 0 &&
      deleteHiddenIds.length === 0 &&
      newXUsers.length === 0
    ) {
      return {
        ok: true,
        message: `編集権限を反映しました（付与 0 / 解除 0 / 変更なし ${unchanged}）`,
        granted: [],
        revoked: [],
        unchanged,
      };
    }

    const statements: BatchItem<"sqlite">[] = [];
    const expected: Array<number | null> = [];
    const audits: WriteAuditLogInput[] = [];

    statements.push(db.run(buildPermissionSetGuardSql(video.id, xids, existingRows)));
    expected.push(null);
    if (insertHiddenRows.length > 0 || deleteHiddenIds.length > 0) {
      statements.push(db.run(buildMemberCountGuardSql(video.id, currentMemberCount)));
      expected.push(null);
    }
    if (newXUsers.length > 0) {
      statements.push(db.run(buildXUsersBulkInsertSql(newXUsers)));
      expected.push(newXUsers.length);
      audits.push({
        table_name: "x_users_permission_batch",
        target_id: video.id,
        operation: "CREATE",
        before: null,
        after: { id: video.id, rows: newXUsers },
        actor_user_id: actor.id,
        context: "video_collab_permissions",
        reason: `共同編集者X IDをpending一括作成 privilege:${privilegeMode}`,
        retention_class: "long_audit",
        restore_strategy: "none",
        strict: true,
      });
    }
    if (updateRows.length > 0) {
      statements.push(db.run(buildMemberPermissionBulkUpdateSql(updateRows)));
      expected.push(updateRows.length);
    }
    if (insertHiddenRows.length > 0) {
      statements.push(db.run(buildHiddenMemberBulkInsertSql(insertHiddenRows)));
      expected.push(insertHiddenRows.length);
    }
    if (deleteHiddenIds.length > 0) {
      statements.push(db.run(buildHiddenMemberBulkDeleteSql(video.id, deleteHiddenIds)));
      expected.push(deleteHiddenIds.length);
    }

    const afterById = new Map(existingRows.map((row) => [row.id, row]));
    for (const row of updateRows) afterById.set(row.id, row);
    for (const id of deleteHiddenIds) afterById.delete(id);
    for (const row of insertHiddenRows) afterById.set(row.id, row);
    audits.push({
      table_name: "video_member_permissions_batch",
      target_id: video.id,
      operation: "MERGE",
      before: {
        id: video.id,
        rows: sortPermissionRows(existingRows).map(permissionSnapshotRow),
      },
      after: {
        id: video.id,
        rows: sortPermissionRows([...afterById.values()]).map(permissionSnapshotRow),
      },
      actor_user_id: actor.id,
      context: "video_collab_permissions",
      reason: `共同編集権限を一括更新 privilege:${privilegeMode}`,
      retention_class: "long_audit",
      restore_strategy: "none",
      strict: true,
    });

    let notificationWakeSource: "manage" | undefined;
    if (notifyXids.length > 0) {
      const links = await db
        .select({
          x_user_id: xUserAccountLinks.x_user_id,
          auth_user_id: xUserAccountLinks.auth_user_id,
        })
        .from(xUserAccountLinks)
        .where(sql`lower(${xUserAccountLinks.x_user_id}) IN (
          SELECT lower(CAST(value AS TEXT)) FROM json_each(${JSON.stringify(notifyXids)})
        )`);
      const notificationByKey = new Map<
        string,
        {
          recipientUserId: string;
          type: "video_edit_permission_granted";
          dedupeKey: string;
          payload: ReturnType<typeof buildVideoEditPermissionGrantedNotification>;
          eventId: string | null;
        }
      >();
      for (const link of links) {
        if (link.auth_user_id === actor.id) continue;
        const dedupeKey = `video_edit_permission_granted:${video.id}:x:${link.x_user_id}:user:${link.auth_user_id}`;
        notificationByKey.set(dedupeKey, {
          recipientUserId: link.auth_user_id,
          type: "video_edit_permission_granted",
          dedupeKey,
          payload: buildVideoEditPermissionGrantedNotification({
            videoId: video.id,
            videoTitle: video.title,
          }),
          eventId: video.primary_event_id,
        });
      }
      const notificationInputs = [...notificationByKey.values()];
      for (let offset = 0; offset < notificationInputs.length; offset += 200) {
        const notification = await buildKnownRecipientNotificationBulkBatch(
          db,
          notificationInputs.slice(offset, offset + 200),
        );
        statements.push(...notification.statements);
        expected.push(...notification.expectedChanges);
        if (notification.statements.length > 0) notificationWakeSource = "manage";
      }
    }

    const queue = await buildStaticRebuildQueueBatch(db, [
      memberSuggestionsTarget("video_permissions_batch"),
    ]);
    statements.push(...queue.statements);
    expected.push(...queue.expectedChanges);

    try {
      await mutateWithAudit(db, {
        mutationStatements: statements,
        expectedMutationChanges: expected,
        audits,
        notificationWakeSource,
        staticRebuildWakeSource: queue.statements.length > 0 ? "manage" : undefined,
      });
    } catch (error) {
      unstable_rethrow(error);
      console.error("[video-collab-perms] batch permission update failed", error);
      return { ok: false, message: "編集権限・通知・監査の更新に失敗しました。最新状態を確認して再試行してください。" };
    }

    await revalidateVideoCollabPathsBestEffort(video.id);
    return {
      ok: true,
      message: `編集権限を反映しました（付与 ${grantedNames.length} / 解除 ${revokedNames.length} / 変更なし ${unchanged}）`,
      granted: grantedNames,
      revoked: revokedNames,
      unchanged,
    };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[video-collab-perms] batch preparation failed", error);
    return { ok: false, message: "合作権限の読込・準備に失敗しました。" };
  }
}
