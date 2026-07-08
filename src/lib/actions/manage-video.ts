"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { canEditEvent } from "@/lib/auth/ownership";
import { getDatabase } from "@/lib/cloudflare";
import { videos, videoEvents } from "@/lib/db/schema";
import { auditAction } from "@/lib/audit/helpers";
import { enqueueVideoStatusChangeNotification } from "@/lib/notifications/videoStatusNotify";

export interface ManageVideoActionResult {
  ok: boolean;
  message?: string;
}

/** イベント運営者が通常操作で変更できる公開状態。内部状態は管理者側に集約する。 */
const MANAGE_ALLOWED_STATUS = new Set(["pending", "public", "private"]);

export async function setManageVideoStatus(
  formData: FormData,
): Promise<ManageVideoActionResult> {
  const session = await auth().catch(() => null);
  const u = session?.user as
    | { id?: string; role?: string; active_x_user_id?: string | null }
    | undefined;
  if (!u?.id) {
    return { ok: false, message: "ログインが必要です。" };
  }

  const eventId = String(formData.get("event_id") ?? "").trim();
  const videoId = String(formData.get("video_id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();

  if (!eventId || !videoId) {
    return { ok: false, message: "event_id と video_id が必要です。" };
  }
  if (!MANAGE_ALLOWED_STATUS.has(status)) {
    return { ok: false, message: "このステータスへは変更できません。" };
  }

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const isAdmin = u.role === "admin";
  const sessionUser = { id: u.id, role: u.role, active_x_user_id: u.active_x_user_id };
  if (!isAdmin) {
    const allowed = await canEditEvent(db, sessionUser, eventId, "video.status");
    if (!allowed) {
      return { ok: false, message: "このイベントの作品審査権限がありません。" };
    }
  }

  const link = (
    await db
      .select({ video_id: videoEvents.video_id })
      .from(videoEvents)
      .where(
        and(
          eq(videoEvents.event_id, eventId),
          eq(videoEvents.video_id, videoId),
        )!,
      )
      .limit(1)
  )[0];
  if (!link) {
    return { ok: false, message: "このイベントに紐づく作品ではありません。" };
  }

  const target = (
    await db.select().from(videos).where(eq(videos.id, videoId)).limit(1)
  )[0];
  if (!target) return { ok: false, message: "対象作品が見つかりません。" };

  const prevStatus = target.visibility_status;
  if (prevStatus === status) {
    return { ok: false, message: "変更先のステータスを選択してください。" };
  }

  const now = Math.floor(Date.now() / 1000);
  await db
    .update(videos)
    .set({
      visibility_status: status as typeof videos.$inferInsert.visibility_status,
      updated_at: now,
    })
    .where(eq(videos.id, videoId));

  await auditAction(db, {
    table_name: "videos",
    record_id: videoId,
    action: "UPDATE",
    before_data: { visibility_status: prevStatus },
    after_data: { visibility_status: status, reason: reason || null, event_id: eventId, scope: "manage" },
    operator_discord_id: u.id,
    retention_class: "normal",
  });

  await enqueueVideoStatusChangeNotification(db, {
    videoId,
    videoTitle: target.title,
    youtubeVideoId: target.youtube_video_id,
    prevStatus,
    nextStatus: status,
    reason: reason || null,
    discordUserId: target.submitted_by_discord_user_id,
    eventId,
  });

  revalidatePath(`/manage/events/${eventId}/videos`);
  revalidatePath(`/manage/events/${eventId}/videos/${videoId}`);
  revalidatePath(`/manage/events/${eventId}`);
  revalidatePath("/manage");
  revalidatePath(`/${target.youtube_video_id ?? videoId}`);
  revalidatePath("/list");

  const { enqueueAfterVideoStatusChange } = await import("@/lib/staticRebuild/hooks");
  await enqueueAfterVideoStatusChange(db, {
    videoId,
    requestedByUserId: u.id,
  });

  return { ok: true, message: "ステータスを更新しました。" };
}
