"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import { historyLogs, videoModerationCases, videos } from "@/lib/db/schema";
import { enqueueNotification } from "@/lib/notifications/enqueue";
import { generateId } from "@/lib/utils/id";

export interface AdminActionResult {
  ok: boolean;
  message?: string;
}

const VALID_STATUS = new Set([
  "draft",
  "pending",
  "public",
  "limited",
  "private",
  "hidden",
  "archived",
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

  if (status === "voided" && !reason) {
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
  const prevStatus = target.visibility_status;

  const now = Math.floor(Date.now() / 1000);
  type VideoUpdate = Partial<typeof videos.$inferInsert>;
  const patch: VideoUpdate = {
    visibility_status: status as VideoUpdate["visibility_status"],
    updated_at: now,
  };

  if (status === "voided") {
    const cat = String(formData.get("void_reason_category") ?? "").trim();
    const validCats = new Set([
      "x_id_invalid",
      "duplicate",
      "withdrawn_by_creator",
      "operator_decision",
      "expired",
    ]);
    await db.insert(videoModerationCases).values({
      id: generateId("vmc"),
      video_id: videoId,
      case_type: validCats.has(cat)
        ? cat === "duplicate"
          ? "duplicate"
          : cat === "x_id_invalid"
            ? "x_reapply"
            : "void"
        : "void",
      status: "open",
      public_reason: reason || null,
      private_note: cat || null,
      attempt_count: 0,
      created_by_user_id: u.id,
      created_at: now,
    });
  } else if (prevStatus === "voided" && status !== "voided") {
    await db.insert(videoModerationCases).values({
      id: generateId("vmc"),
      video_id: videoId,
      case_type: "void",
      status: "resolved",
      public_reason: reason || null,
      private_note: "restored",
      attempt_count: 0,
      created_by_user_id: u.id,
      resolved_by_user_id: u.id,
      created_at: now,
      resolved_at: now,
    });
  }

  await db.update(videos).set(patch).where(eq(videos.id, videoId));

  await db.insert(historyLogs).values({
    table_name: "videos",
    record_id: videoId,
    action: "UPDATE",
      before_data: JSON.stringify({ visibility_status: prevStatus }),
    after_data: JSON.stringify({ visibility_status: status, reason: reason || null }),
    operator_discord_id: u.id,
    retention_class:
      status === "voided"
        ? "long_audit"
        : "normal",
    created_at: now,
  });

  // 通知 enqueue: 投稿主に状態変化を伝える。
  // submitted_by_discord_user_id を宛先とし、event-scoped なら primary_event_id を載せる。
  if (target.submitted_by_discord_user_id && prevStatus !== status) {
    const typeMap: Record<string, string> = {
      public: "video_approved",
      pending: "video_pending",
      voided: "video_voided",
      limited: "video_limited",
      private: "video_private",
      hidden: "video_hidden",
      archived: "video_archived",
      draft: "video_draft",
    };
    const notifType = typeMap[status] ?? "video_status_changed";
    await enqueueNotification(db, {
      discordUserId: target.submitted_by_discord_user_id,
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
