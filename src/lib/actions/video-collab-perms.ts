"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { loadNotifiableRecipientLinks } from "@flamenode/server-core/video/permissionRecipients";
import { buildPermissionGrantNotificationInputs } from "@flamenode/server-core/video/permissionNotificationInputs";
import { buildPermissionMutationBatch } from "@flamenode/server-core/video/permissionMutationBatch";
import { preparePermissionWrite } from "@flamenode/server-core/video/permissionPreparation";
import { resolvePermissionSubjectXUserId } from "@flamenode/server-core/video/permissionSubject";
import { buildPermissionWriteAudits } from "@flamenode/server-core/video/permissionPlan";
import { permissionRebuildTargets } from "@flamenode/server-core/video/permissionRebuildTargets";

import { writeGuard } from "@/lib/auth/writeGuard";
import {
  canEditVideo,
  canUseEventPrivilegeModeForVideo,
  resolveVideoEditAccessContext,
  type CanEditVideoPrivilegeMode,
  type VideoEditAccessContext,
} from "@/lib/auth/ownership";
import { videos } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import { upsertSchema, permissionBatchSchema, parseVideoCollaboratorDeleteInput } from "@flamenode/domain/video";
import { buildKnownRecipientNotificationBulkBatch } from "@/lib/notifications/enqueue";
import { buildVideoEditPermissionGrantedNotification } from "@/lib/notifications/templates/video";
import { mutateWithAudit } from "@/lib/audit/mutate";
import { runPostCommitBestEffort } from "@/lib/audit/postCommit";
import { createTraceId } from "@/lib/observability/flowTrace";
import { buildStaticRebuildQueueBatch } from "@/lib/staticRebuild/enqueue";
import { loadVideoRebuildEventIds } from "@/lib/video/videoVisibilityStatusAction";

export interface VideoCollabResult {
  ok: boolean;
  message?: string;
}

export interface VideoCollabPermissionBatchResult extends VideoCollabResult {
  granted?: string[];
  revoked?: string[];
  unchanged?: number;
}

type DB = NonNullable<ReturnType<typeof getDatabase>>;
type PermissionIntent = {
  x_user_id: string;
  display_name: string;
  intent: "on" | "off";
};

type EditableVideo = Pick<
  typeof videos.$inferSelect,
  | "id"
  | "title"
  | "primary_event_id"
  | "creator_x_user_id"
  | "submitted_by_user_id"
  | "visibility_status"
> & { privilegeMode: CanEditVideoPrivilegeMode };

async function revalidateVideoCollabPathsBestEffort(videoId: string): Promise<void> {
  await runPostCommitBestEffort(
    { flow: "video_collab_permissions", traceId: createTraceId() },
    [
      {
        name: "revalidate_video_collab_paths",
        run: async () => {
          revalidatePath(`/dashboard/edit/${videoId}`);
          revalidatePath(`/dashboard/edit/${videoId}/permissions`);
        },
      },
    ],
  );
}

async function resolvePrivilegeMode(
  rawMode: string,
  user: { id: string; role?: string | null },
  video: Pick<typeof videos.$inferSelect, "id">,
  accessContext: VideoEditAccessContext,
): Promise<CanEditVideoPrivilegeMode> {
  if (rawMode === "admin" && user.role === "admin") return "admin";
  if (rawMode === "event") {
    const canUseEvent = await canUseEventPrivilegeModeForVideo({ user, video, accessContext });
    if (canUseEvent) return "event";
  }
  return "normal";
}

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
  const accessContext = await resolveVideoEditAccessContext({
    db,
    user: actor,
    video,
  });
  const requested = privilegeModeRaw.trim();
  const requestedMode = await resolvePrivilegeMode(requested, actor, video, accessContext);
  const requestedAllowed = await canEditVideo({
    db,
    user: actor,
    video,
    requiredKey: "video.permissions",
    privilegeMode: requestedMode,
    accessContext,
  });
  if (requestedAllowed) return { ...video, privilegeMode: requestedMode };

  if (requested) return null;
  if (actor.role === "admin") {
    const adminAllowed = await canEditVideo({
      db,
      user: actor,
      video,
      requiredKey: "video.permissions",
      privilegeMode: "admin",
      accessContext,
    });
    if (adminAllowed) return { ...video, privilegeMode: "admin" };
  }

  const canUseEvent = await canUseEventPrivilegeModeForVideo({ user: actor, video, accessContext });
  if (canUseEvent) {
    const eventAllowed = await canEditVideo({
      db,
      user: actor,
      video,
      requiredKey: "video.permissions",
      privilegeMode: "event",
      accessContext,
    });
    if (eventAllowed) return { ...video, privilegeMode: "event" };
  }
  return null;
}

async function applyPermissionIntentsToVideo(
  db: DB,
  actor: { id: string; role?: string | null },
  video: EditableVideo,
  args: {
    intents: readonly PermissionIntent[];
    notify: boolean;
  },
): Promise<VideoCollabPermissionBatchResult> {
  const preparation = await preparePermissionWrite(db, {
    videoId: video.id,
    actorId: actor.id,
    intents: args.intents,
    notify: args.notify,
    now: Math.floor(Date.now() / 1000),
    makeMemberId: () => generateId("vm"),
  });
  if (preparation.kind === "error") return { ok: false, message: preparation.message };
  if (preparation.kind === "terminal") return preparation.result;
  const { xids, existingRows, currentHiddenEditorCount, plan } = preparation;
  const { newXUsers, grantedNames, revokedNames, notifyXids, unchanged } = plan;

  const mutation = buildPermissionMutationBatch(db, {
    videoId: video.id,
    xids,
    existingRows,
    currentHiddenEditorCount,
    plan,
  });
  const statements = [...mutation.statements];
  const expected: Array<number | null> = [...mutation.expectedChanges];
  const audits = buildPermissionWriteAudits({
    videoId: video.id,
    actorUserId: actor.id,
    privilegeMode: video.privilegeMode,
    existingRows,
    plan,
  });

  let notificationWakeSource: "manage" | undefined;
  if (notifyXids.length > 0) {
    const links = await loadNotifiableRecipientLinks(db, notifyXids);
    const notificationInputs = buildPermissionGrantNotificationInputs({
      links,
      actorUserId: actor.id,
      videoId: video.id,
      videoTitle: video.title,
      eventId: video.primary_event_id,
      buildPayload: buildVideoEditPermissionGrantedNotification,
    });
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

  const rebuildEvents = await loadVideoRebuildEventIds(
    db,
    video.id,
    video.primary_event_id,
  );
  if (!rebuildEvents.ok) return { ok: false, message: rebuildEvents.message };

  const queue = await buildStaticRebuildQueueBatch(db, permissionRebuildTargets({
    hasNewXUsers: newXUsers.length > 0,
    visibilityStatus: video.visibility_status,
    eventIds: rebuildEvents.eventIds,
    actorUserId: actor.id,
  }));
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
    console.error("[video-collab-perms] permission mutation failed", error);
    return {
      ok: false,
      message: "編集権限・通知・監査の更新に失敗しました。最新状態を確認して再試行してください。",
    };
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

export async function upsertVideoCollaborator(
  formData: FormData,
): Promise<VideoCollabResult> {
  const guard = await writeGuard({ feature: "edit_video" });
  if (!guard.ok) return { ok: false, message: guard.message };
  const actor = { id: guard.user.id, role: guard.user.role ?? null };
  const parsed = upsertSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "入力エラー" };
  }

  // writeGuard が解決済みの同一 request context / D1 binding を使う。
  // OpenNext 上でDBを再解決すると、認証通過後だけ binding 解決に
  // 失敗して権限設定できない状態になり得る。
  const db = guard.db;

  try {
    const video = await loadEditableVideoForPermissions(
      db,
      actor,
      parsed.data.video_id,
      String(formData.get("edit_privilege_mode") ?? "").trim(),
    );
    if (!video) {
      return { ok: false, message: "対象作品が見つからない、または権限がありません。" };
    }

    const resolved = await resolvePermissionSubjectXUserId(
      db,
      parsed.data.x_user_id || null,
      parsed.data.user_id?.trim() || null,
    );
    if (!resolved.ok) return { ok: false, message: resolved.message };

    const result = await applyPermissionIntentsToVideo(db, actor, video, {
      notify: parsed.data.notify,
      intents: [
        {
          x_user_id: resolved.xUserId,
          display_name: parsed.data.display_name,
          intent: parsed.data.can_edit ? "on" : "off",
        },
      ],
    });
    if (!result.ok) return result;
    return {
      ok: true,
      message: parsed.data.can_edit
        ? "作品編集への参加を付与しました。"
        : "作品編集への参加を無効化しました。",
    };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[video-collab-perms] collaborator action failed", error);
    return { ok: false, message: "合作権限の読込・更新に失敗しました。" };
  }
}

export async function deleteVideoCollaborator(
  formData: FormData,
): Promise<VideoCollabResult> {
  const guard = await writeGuard({ feature: "edit_video" });
  if (!guard.ok) return { ok: false, message: guard.message };
  const actor = { id: guard.user.id, role: guard.user.role ?? null };
  const input = parseVideoCollaboratorDeleteInput({
    video_id: formData.get("video_id"),
    x_user_id: formData.get("x_user_id"),
  });
  if (!input.ok) return { ok: false, message: input.message };
  const { videoId, xUserId: rawXId } = input;

  const db = guard.db;

  try {
    const video = await loadEditableVideoForPermissions(
      db,
      actor,
      videoId,
      String(formData.get("edit_privilege_mode") ?? "").trim(),
    );
    if (!video) {
      return { ok: false, message: "対象作品が見つからない、または権限がありません。" };
    }
    const resolved = await resolvePermissionSubjectXUserId(db, rawXId, null);
    if (!resolved.ok) return { ok: false, message: resolved.message };

    const result = await applyPermissionIntentsToVideo(db, actor, video, {
      notify: false,
      intents: [
        {
          x_user_id: resolved.xUserId,
          display_name: `@${resolved.xUserId}`,
          intent: "off",
        },
      ],
    });
    if (!result.ok) return result;
    return { ok: true, message: "作品編集への参加を解除しました。" };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[video-collab-perms] collaborator revoke failed", error);
    return { ok: false, message: "合作権限の読込・解除に失敗しました。" };
  }
}

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

  const db = guard.db;

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

    return await applyPermissionIntentsToVideo(db, actor, video, {
      notify: parsed.data.notify,
      intents: parsed.data.intents,
    });
  } catch (error) {
    unstable_rethrow(error);
    console.error("[video-collab-perms] batch preparation failed", error);
    return { ok: false, message: "合作権限の読込・準備に失敗しました。" };
  }
}
