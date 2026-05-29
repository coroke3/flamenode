"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import { historyLogs, videoModerationCases, videos } from "@/lib/db/schema";

export interface ModerationAdminResult {
  ok: boolean;
  message?: string;
}

const CASE_STATUSES = new Set(["resolved", "rejected", "cancelled", "expired"]);
const VIDEO_STATUSES = new Set([
  "draft",
  "pending",
  "public",
  "limited",
  "private",
  "hidden",
  "archived",
  "voided",
]);

export async function updateModerationCaseStatus(
  formData: FormData,
): Promise<ModerationAdminResult> {
  const session = await auth().catch(() => null);
  const u = session?.user as { id?: string; role?: string } | undefined;
  if (!u?.id || u.role !== "admin") {
    return { ok: false, message: "管理者のみ操作できます。" };
  }

  const id = String(formData.get("id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const note = String(formData.get("private_note") ?? "").trim().slice(0, 2000);
  const nextVideoStatus = String(formData.get("video_status") ?? "").trim();
  if (!id) return { ok: false, message: "id が必要です。" };
  if (!CASE_STATUSES.has(status)) return { ok: false, message: "不正な status です。" };

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const current = (
    await db.select().from(videoModerationCases).where(eq(videoModerationCases.id, id)).limit(1)
  )[0];
  if (!current) return { ok: false, message: "case が見つかりません。" };
  if (current.status !== "open") {
    return { ok: false, message: `status=${current.status} は更新対象外です。` };
  }

  const now = Math.floor(Date.now() / 1000);
  await db
    .update(videoModerationCases)
    .set({
      status: status as (typeof videoModerationCases.$inferInsert)["status"],
      private_note: note || current.private_note,
      resolved_by_user_id: u.id,
      resolved_at: now,
    })
    .where(eq(videoModerationCases.id, id));

  let videoStatusChanged: string | null = null;
  if (nextVideoStatus && VIDEO_STATUSES.has(nextVideoStatus)) {
    await db
      .update(videos)
      .set({
        visibility_status: nextVideoStatus as (typeof videos.$inferInsert)["visibility_status"],
        updated_at: now,
      })
      .where(eq(videos.id, current.video_id));
    videoStatusChanged = nextVideoStatus;
  }

  await db.insert(historyLogs).values({
    table_name: "video_moderation_cases",
    record_id: id,
    action: "UPDATE",
    before_data: JSON.stringify({ status: current.status }),
    after_data: JSON.stringify({
      status,
      note: note || null,
      video_status: videoStatusChanged,
    }),
    operator_discord_id: u.id,
    retention_class: "long_audit",
    created_at: now,
  });

  revalidatePath("/admin/moderation");
  revalidatePath(`/admin/videos/${current.video_id}`);
  return { ok: true, message: "case を更新しました。" };
}
