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
import { videoMembers, videos, xUsers } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import { normalizeXId } from "@/lib/utils/xid";
import { buildKnownRecipientNotificationBatch } from "@/lib/notifications/enqueue";
import { buildVideoEditPermissionGrantedNotification } from "@/lib/notifications/templates/video";
import { expectedRowCondition } from "@/lib/audit/adapters";
import { mutateWithAudit } from "@/lib/audit/mutate";
import { runPostCommitBestEffort } from "@/lib/audit/postCommit";
import type { WriteAuditLogInput } from "@/lib/audit/types";
import { createTraceId } from "@/lib/observability/flowTrace";
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

type DB = NonNullable<ReturnType<typeof getDatabase>>;

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
  if (raw === "admin" && user.role === "admin") return "admin";
  if (raw === "event") {
    const canUseEvent = await canUseEventPrivilegeModeForVideo({
      db,
      user,
      video,
    });
    if (canUseEvent) return "event";
  }
  return "normal";
}

async function loadEditableVideo(
  db: DB,
  user: { id: string; role?: string | null },
  videoId: string,
  formData: FormData,
) {
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
  const privilegeMode = await resolvePrivilegeModeFromForm(db, formData, user, video);
  const allowed = await canEditVideo({
    db,
    user,
    video,
    requiredKey: "video.permissions",
    privilegeMode,
  });
  return allowed ? { ...video, privilegeMode } : null;
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

  try {
    await mutateWithAudit(db, {
      mutationStatements: statements,
      expectedMutationChanges: expected,
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
