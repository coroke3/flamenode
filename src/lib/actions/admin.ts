"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import { historyLogs, videos } from "@/lib/db/schema";
import { enqueueNotification } from "@/lib/notifications/enqueue";

export interface AdminActionResult {
  ok: boolean;
  message?: string;
}

const VALID_STATUS = new Set([
  "draft",
  "pending",
  "x_reapply_required",
  "public",
  "unlisted",
  "private",
  "voided",
]);

export async function setVideoStatus(
  formData: FormData,
): Promise<AdminActionResult> {
  const session = await auth().catch(() => null);
  const u = session?.user as { id?: string; role?: string } | undefined;
  if (!u?.id || u.role !== "admin") {
    return { ok: false, message: "管理者のみ操作できます。" };
  }

  const videoId = String(formData.get("video_id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!videoId) return { ok: false, message: "video_id が必要です。" };
  if (!VALID_STATUS.has(status)) {
    return { ok: false, message: "不正なステータスです。" };
  }

  if ((status === "voided" || status === "x_reapply_required") && !reason) {
    return {
      ok: false,
      message: `${status} へ変更するには理由が必要です。`,
    };
  }

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const target = (
    await db.select().from(videos).where(eq(videos.id, videoId)).limit(1)
  )[0];
  if (!target) return { ok: false, message: "対象作品が見つかりません。" };
  const prevStatus = target.status;

  const now = Math.floor(Date.now() / 1000);
  type VideoUpdate = Partial<typeof videos.$inferInsert>;
  const patch: VideoUpdate = {
    status: status as VideoUpdate["status"],
    updated_at: now,
  };

  if (status === "voided") {
    patch.is_deleted = 1;
    patch.voided_by_user_id = u.id;
    patch.voided_at = now;
    patch.void_reason = reason;
    const cat = String(formData.get("void_reason_category") ?? "").trim();
    const validCats = new Set([
      "x_id_invalid",
      "duplicate",
      "withdrawn_by_creator",
      "operator_decision",
      "expired",
    ]);
    if (cat && validCats.has(cat)) {
      patch.void_reason_category = cat as
        | "x_id_invalid"
        | "duplicate"
        | "withdrawn_by_creator"
        | "operator_decision"
        | "expired";
    }
  } else if (prevStatus === "voided" && status !== "voided") {
    patch.is_deleted = 0;
    patch.void_restored_by_user_id = u.id;
    patch.void_restored_at = now;
  }

  if (status === "x_reapply_required") {
    patch.x_reapply_started_at = now;
    patch.x_reapply_due_at = now + 7 * 24 * 3600;
    patch.x_reapply_public_reason = reason;
  }

  await db.update(videos).set(patch).where(eq(videos.id, videoId));

  await db.insert(historyLogs).values({
    table_name: "videos",
    record_id: videoId,
    action: "UPDATE",
    before_data: JSON.stringify({ status: prevStatus }),
    after_data: JSON.stringify({ status, reason: reason || null }),
    operator_discord_id: u.id,
    retention_class:
      status === "voided" || status === "x_reapply_required"
        ? "long_audit"
        : "normal",
    created_at: now,
  });

  // 通知 enqueue: 投稿主に状態変化を伝える。
  // owner_discord_user_id を宛先とし、event-scoped なら primary_event_id を載せる。
  if (target.owner_discord_user_id && prevStatus !== status) {
    const typeMap: Record<string, string> = {
      public: "video_approved",
      pending: "video_pending",
      voided: "video_voided",
      x_reapply_required: "video_x_reapply_required",
      unlisted: "video_unlisted",
      private: "video_private",
      draft: "video_draft",
    };
    const notifType = typeMap[status] ?? "video_status_changed";
    await enqueueNotification(db, {
      discordUserId: target.owner_discord_user_id,
      type: notifType,
      payload: {
        content: `作品「${target.title}」のステータスが ${prevStatus} → ${status} に変更されました。`,
        video_id: videoId,
        prev_status: prevStatus,
        next_status: status,
        reason: reason || undefined,
      },
      eventId: target.primary_event_id ?? null,
    });
  }

  revalidatePath(`/admin/videos/${videoId}`);
  revalidatePath("/admin/videos");
  revalidatePath("/admin");
  revalidatePath(`/${target.youtube_video_id ?? videoId}`);
  revalidatePath("/list");
  return { ok: true, message: "ステータスを更新しました。" };
}
