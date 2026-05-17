"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
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

/**
 * failed 通知の一括リトライ。
 * MAX 件数を上限 (50) で打ち切り、attempt_count を 0 に戻す。
 * 履歴には件数だけ残す (個々の id は残さない、ボリュームが大きいため)。
 */
const BULK_RETRY_MAX = 50;

export async function retryAllFailedNotifications(
  _formData: FormData,
): Promise<NotificationAdminResult & { retried?: number }> {
  const session = await auth().catch(() => null);
  const u = session?.user as { id?: string; role?: string } | undefined;
  if (!u?.id || u.role !== "admin") {
    return { ok: false, message: "管理者のみ操作できます。" };
  }

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  // 上限を超えると大量 enqueue になるため、最古から BULK_RETRY_MAX 件のみ拾う。
  const targets = await db
    .select({ id: notificationOutbox.id })
    .from(notificationOutbox)
    .where(eq(notificationOutbox.status, "failed"))
    .limit(BULK_RETRY_MAX);
  if (targets.length === 0) {
    return { ok: true, message: "failed 通知はありません。", retried: 0 };
  }

  const now = Math.floor(Date.now() / 1000);
  const ids = targets.map((t) => t.id);
  // SQLite IN 句で一括 UPDATE
  await db
    .update(notificationOutbox)
    .set({
      status: "pending",
      attempt_count: 0,
      next_attempt_at: now,
      last_error: null,
    })
    .where(
      sql`${notificationOutbox.id} IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    );

  await db.insert(historyLogs).values({
    table_name: "notification_outbox",
    record_id: "bulk_retry",
    action: "UPDATE",
    after_data: JSON.stringify({
      manual_bulk_retry: true,
      retried_count: ids.length,
      retried_by: u.id,
      retried_at: now,
    }),
    operator_discord_id: u.id,
    retention_class: "long_audit",
    created_at: now,
  });

  revalidatePath("/admin/notifications");
  return {
    ok: true,
    message: `${ids.length} 件の failed を pending に戻しました (上限 ${BULK_RETRY_MAX})。`,
    retried: ids.length,
  };
}
