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
  // Worker は attempt_count < MAX_RETRIES のみ拾うため、手動リトライでは
  // attempt_count を 0 にリセットしないと再試行が走らない。
  // 履歴に直前の attempt_count を残して状況把握できるようにする。
  const prevAttempt = target.attempt_count ?? 0;
  await db
    .update(notificationOutbox)
    .set({
      status: "pending",
      attempt_count: 0,
      next_attempt_at: now,
      last_error: null,
    })
    .where(eq(notificationOutbox.id, id));

  await db.insert(historyLogs).values({
    table_name: "notification_outbox",
    record_id: id,
    action: "UPDATE",
    before_data: JSON.stringify({
      status: "failed",
      attempt_count: prevAttempt,
      last_error: target.last_error,
    }),
    after_data: JSON.stringify({
      status: "pending",
      attempt_count: 0,
      manual_retry: true,
      retried_by: u.id,
      retried_at: now,
    }),
    operator_discord_id: u.id,
    retention_class: "normal",
    created_at: now,
  });

  revalidatePath("/admin/notifications");
  return { ok: true, message: "通知を pending に戻しました。" };
}
