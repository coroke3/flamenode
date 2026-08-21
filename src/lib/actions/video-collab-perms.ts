"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDatabase } from "@/lib/cloudflare";
import { writeGuard } from "@/lib/auth/writeGuard";
import {
  canEditVideo,
  canUseEventPrivilegeModeForVideo,
  type CanEditVideoPrivilegeMode,
} from "@/lib/auth/ownership";
import { videoMembers, videos, xUsers } from "@/lib/db/schema";
import { MAX_VIDEO_MEMBERS } from "@/lib/video/atomicLimits";
import { generateId } from "@/lib/utils/id";
import { normalizeXId } from "@/lib/utils/xid";
import { buildKnownRecipientNotificationBatch } from "@/lib/notifications/enqueue";
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
 * 上で差分 UPDATE / INSERT / DELETE を行う。
 */
export const MAX_COLLABORATOR_PERMISSION_BATCH = 50;

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

async function resolvePrivilegeModeFromForm(
  db: DB,
  formData: FormData,
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
  const raw = String(formData.get("edit_privilege_mode") ?? "").trim();
  return resolvePrivilegeMode(db, raw, user, video);
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
  const privilegeMode = await resolvePrivilegeMode(db, privilegeModeRaw, actor, video);
  const allowed = await canEditVideo({
    db,
    user: actor,
    video,
    requiredKey: "video.permissions",
    privilegeMode,
  });
  return allowed ? { ...video, privilegeMode } : null;
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
  // 既存callerはformData由来のprivilegeModeを期待するため形は維持する。
  void raw;
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

export async function upsertVideoCollaborator(formData: FormData): Promise<VideoCollabResult> {
  const guard = await writeGuard({ feature: "edit_video" });
  if (!guard.ok) return { ok: false, message: guard.message };
  const actor = { id: guard.user.id, role: guard.user.role ?? null };
  const parsed = upsertSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "入力エラー" };
  }

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
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

  // pending x_users作成・hidden video_members作成をmember_suggestions indexへ反映する。
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
}

export async function deleteVideoCollaborator(formData: FormData): Promise<VideoCollabResult> {
  const guard = await writeGuard({ feature: "edit_video" });
  if (!guard.ok) return { ok: false, message: guard.message };
  const actor = { id: guard.user.id, role: guard.user.role ?? null };
  const videoId = String(formData.get("video_id") ?? "").trim();
  const xUserId = normalizeXId(String(formData.get("x_user_id") ?? ""));
  if (!videoId || !xUserId) return { ok: false, message: "video_id と X ID が必要です。" };

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
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
}

const PERMISSION_BATCH_IN_CLAUSE_SIZE = 80;

function chunkXIds(ids: readonly string[]): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += PERMISSION_BATCH_IN_CLAUSE_SIZE) {
    chunks.push(ids.slice(i, i + PERMISSION_BATCH_IN_CLAUSE_SIZE));
  }
  return chunks;
}

/**
 * TSV権限列の一括反映。video取得・actor権限（video.permissions）検証・privilege mode
 * 再検証を1回だけ行い、既存video_membersをbounded queryで取得して差分のみ
 * UPDATE / INSERT / DELETEする。監査・expectedRowCondition・通知はsingle actionと
 * 同じ意味論を共有し、member_suggestions再生成も同一atomic writeへ含める。
 *
 * OFF時の挙動は deleteVideoCollaborator と同じ:
 * - 公開メンバー行は行を残し can_edit=0
 * - 非公開編集者専用行（is_public_member=0）は行ごと削除
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

  // X IDはnormalizeし、重複を排除（先勝まり）。
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

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
  const video = await loadEditableVideoForPermissions(
    db,
    actor,
    parsed.data.video_id,
    parsed.data.edit_privilege_mode ?? "",
  );
  if (!video) return { ok: false, message: "対象作品が見つからない、または権限がありません。" };
  const privilegeMode = video.privilegeMode;

  // 既存video_membersをbounded queryで取得。
  const existingRows = (
    await db
      .select()
      .from(videoMembers)
      .where(
        and(
          eq(videoMembers.video_id, video.id),
          isNotNull(videoMembers.x_user_id),
          sql`lower(${videoMembers.x_user_id}) IN (${sql.join(
            xids.map((xid) => sql`${xid}`),
            sql`, `,
          )})`,
        )!,
      )
  ).slice(0, MAX_VIDEO_MEMBERS + xids.length);
  const existingByXid = new Map<string, typeof videoMembers.$inferSelect>();
  for (const row of existingRows) {
    const key = normalizeXId(row.x_user_id ?? "");
    if (key && !existingByXid.has(key)) existingByXid.set(key, row);
  }

  // MAX_VIDEO_MEMBERS等のatomic limitを守るため現在行数を1回数える。
  const currentCountRow = await db
    .select({ count: sql<number>`count(*)` })
    .from(videoMembers)
    .where(eq(videoMembers.video_id, video.id));
  let memberRowCount = Number(currentCountRow[0]?.count ?? 0);

  // 付与対象のうち実在しないx_usersを特定（pending作成は既存upsertと同じ意味論）。
  const grantXids = xids.filter((xid) => intents.get(xid)?.intent === "on");
  const missingProfileIds = new Set<string>();
  for (const ids of chunkXIds(grantXids)) {
    const found = await db
      .select({ id: xUsers.id })
      .from(xUsers)
      .where(inArray(sql`lower(${xUsers.id})`, ids));
    const foundLower = new Set(found.map((row) => row.id.toLowerCase()));
    for (const xid of ids) {
      if (!foundLower.has(xid)) missingProfileIds.add(xid);
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const statements: BatchItem<"sqlite">[] = [];
  const expected: Array<number | null> = [];
  const audits: WriteAuditLogInput[] = [];
  const grantedNames: string[] = [];
  const revokedNames: string[] = [];
  let unchanged = 0;
  let notificationWakeSource: "manage" | undefined;

  for (const [xid, intentInfo] of intents) {
    const label = `${intentInfo.displayName} @${xid}`;
    const existing = existingByXid.get(xid);

    if (intentInfo.intent === "on") {
      if (existing?.can_edit === 1) {
        unchanged += 1;
        continue;
      }
      if (!existing) {
        // 新規行はMAX_VIDEO_MEMBERS内でのみ許可する。
        if (memberRowCount >= MAX_VIDEO_MEMBERS) {
          return {
            ok: false,
            message: `合作メンバーは最大${MAX_VIDEO_MEMBERS}人です。これ以上編集権を付与できません。`,
          };
        }
        memberRowCount += 1;
      }
      // 未知x_userはpending作成（既存single actionと同じ監査付き）。
      if (missingProfileIds.has(xid)) {
        const xAfter: typeof xUsers.$inferInsert = {
          id: xid,
          x_name: intentInfo.displayName || `@${xid}`,
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
          target_id: xid,
          operation: "CREATE",
          before: null,
          after: xAfter,
          actor_user_id: actor.id,
          context: "video_collab_permissions",
          reason: "共同編集者X IDをpending作成 (batch)",
          retention_class: "long_audit",
          strict: true,
        });
      }
      const wasCanEdit = existing?.can_edit === 1;
      if (existing) {
        const patch = {
          name: intentInfo.displayName || existing.name,
          can_edit: 1,
          edit_granted_by_auth_user_id: actor.id,
          edit_granted_at: existing.edit_granted_at == null ? now : existing.edit_granted_at,
          edit_updated_at: now,
        };
        const afterMember = { ...existing, ...patch };
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
          after: afterMember,
          actor_user_id: actor.id,
          context: "video_collab_permissions",
          reason: `共同編集権限を更新 (batch) privilege:${privilegeMode}`,
          retention_class: "long_audit",
          strict: true,
        });
      } else {
        const memberAfter: typeof videoMembers.$inferSelect = {
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
          reason: `共同編集権限を作成 (batch) privilege:${privilegeMode}`,
          retention_class: "long_audit",
          strict: true,
        });
      }
      // 通知は既存single actionと同じ意味論（付与時・notify指定時・本人以外）。
      if (!wasCanEdit && parsed.data.notify) {
        const recipientIds = (await getAuthUserIdsForXUser(db, xid)).filter(
          (recipientId) => recipientId !== actor.id,
        );
        if (recipientIds.length > 0) {
          const notification = await buildKnownRecipientNotificationBatch(
            db,
            recipientIds.map((recipientUserId) => ({
              recipientUserId,
              type: "video_edit_permission_granted" as const,
              dedupeKey: `video_edit_permission_granted:${video.id}:x:${xid}:user:${recipientUserId}`,
              payload: buildVideoEditPermissionGrantedNotification({
                videoId: video.id,
                videoTitle: video.title,
              }),
              eventId: video.primary_event_id,
            })),
          );
          statements.push(...notification.statements);
          expected.push(...notification.expectedChanges);
          notificationWakeSource = "manage";
        }
      }
      grantedNames.push(label);
      continue;
    }

    // intent === "off"
    if (!existing || existing.can_edit !== 1) {
      unchanged += 1;
      continue;
    }
    const deleteRow = existing.is_public_member === 0;
    const after = deleteRow
      ? null
      : { ...existing, can_edit: 0, edit_updated_at: now };
    statements.push(
      deleteRow
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
            ),
    );
    expected.push(1);
    audits.push({
      table_name: "video_members",
      target_id: existing.id,
      operation: deleteRow ? "DELETE" : "UPDATE",
      before: existing,
      after,
      actor_user_id: actor.id,
      context: "video_collab_permissions",
      reason: `共同編集権限を解除 (batch) privilege:${privilegeMode}`,
      retention_class: "long_audit",
      strict: true,
    });
    revokedNames.push(label);
  }

  // 本体mutationと同じatomic writeへmember_suggestions再生成を含める。
  const queue = await buildStaticRebuildQueueBatch(db, [
    memberSuggestionsTarget("video_permissions_batch"),
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
    console.error("[video-collab-perms] batch permission update failed", error);
    return { ok: false, message: "編集権限・通知・監査の更新に失敗しました。" };
  }
  await revalidateVideoCollabPathsBestEffort(video.id);
  return {
    ok: true,
    message: `編集権限を反映しました（付与 ${grantedNames.length} / 解除 ${revokedNames.length} / 変更なし ${unchanged}）`,
    granted: grantedNames,
    revoked: revokedNames,
    unchanged,
  };
}
