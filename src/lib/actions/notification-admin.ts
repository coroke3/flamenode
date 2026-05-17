"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import { historyLogs, notificationOutbox } from "@/lib/db/schema";

export interface NotificationAdminResult {
  ok: boolean;
  message?: string;
}

/**
 * failed の通知を pending に戻し、再試行できるようにする。
 * attempt_count はリセットせず、next_attempt_at は now にする (即時試行)。
 * Worker (notification-dispatcher) が次の cron で拾い直す。
 */
export async function retryFailedNotification(
  formData: FormData,
): Promise<NotificationAdminResult> {
  const session = await auth().catch(() => null);
  const u = session?.user as { id?: string; role?: string } | undefined;
  if (!u?.id || u.role !== "admin") {
    return { ok: false, message: "管理者のみ操作できます。" };
  }

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { ok: false, message: "id が必要です。" };

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const target = (
    await db
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.id, id))
      .limit(1)
  )[0];
  if (!target) return { ok: false, message: "通知が見つかりません。" };
  if (target.status !== "failed") {
    return {
      ok: false,
      message: `status=${target.status} の通知はリトライ対象外です。`,
    };
  }

  const now = Math.floor(Date.now() / 1000);
  await db
    .update(notificationOutbox)
    .set({
      status: "pending",
      // attempt_count はそのまま保持する。
      // 過去の失敗回数は次のリトライ管理 (MAX_RETRIES) で再評価される。
      next_attempt_at: now,
      last_error: null,
    })
    .where(eq(notificationOutbox.id, id));

  await db.insert(historyLogs).values({
    table_name: "notification_outbox",
    record_id: id,
    action: "UPDATE",
    before_data: JSON.stringify({ status: "failed" }),
    after_data: JSON.stringify({ status: "pending", manual_retry: true }),
    operator_discord_id: u.id,
    retention_class: "normal",
    created_at: now,
  });

  revalidatePath("/admin/notifications");
  return { ok: true, message: "通知を pending に戻しました。" };
}
