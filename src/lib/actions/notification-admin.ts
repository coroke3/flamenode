"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDatabase } from "@/lib/cloudflare";
import { notificationOutbox } from "@/lib/db/schema";
import { requireAdminWrite } from "@/lib/auth/writeGuard";
import { expectedRowCondition } from "@/lib/audit/adapters";
import { mutateWithAudit } from "@/lib/audit/mutate";
import type { WriteAuditLogInput } from "@/lib/audit/types";
import { buildKnownRecipientNotificationBatch } from "@/lib/notifications/enqueue";
import {
  isTerminalNotificationFailure,
  TERMINAL_NOTIFICATION_FAILURE_STATUSES,
} from "@/lib/notifications/status";

export interface NotificationAdminResult {
  ok: boolean;
  message?: string;
}

type Row = typeof notificationOutbox.$inferSelect;
const BULK_RETRY_MAX = 10;

function failure(error: unknown): NotificationAdminResult {
  console.error("[notification-admin] atomic mutation failed", error);
  return { ok: false, message: "通知更新が競合したか監査記録に失敗しました。" };
}

function revalidateNotificationPages(): void {
  revalidatePath("/admin/notifications");
  revalidatePath("/manage/notifications");
}

async function updateRows(
  db: NonNullable<ReturnType<typeof getDatabase>>,
  rows: Row[],
  actor: string,
  kind: "retry" | "cancel",
  reason?: string,
): Promise<NotificationAdminResult> {
  if (rows.length === 0) return { ok: true };

  const now = Math.floor(Date.now() / 1000);
  const statements: BatchItem<"sqlite">[] = [];
  const audits: WriteAuditLogInput[] = [];

  for (const before of rows) {
    const patch =
      kind === "retry"
        ? {
            status: "pending" as const,
            attempt_count: 0,
            processing_started_at: null,
            lease_token: null,
            lease_expires_at: null,
            next_attempt_at: now,
            last_error: null,
            processed_at: null,
          }
        : {
            status: "cancelled" as const,
            processing_started_at: null,
            lease_token: null,
            lease_expires_at: null,
            next_attempt_at: null,
            last_error: reason || "manual cancel",
            processed_at: now,
          };
    const after = { ...before, ...patch };

    statements.push(
      db
        .update(notificationOutbox)
        .set(patch)
        .where(
          and(
            eq(notificationOutbox.id, before.id),
            expectedRowCondition({ expectedCurrent: { ...before } }),
          )!,
        ),
    );
    audits.push({
      table_name: "notification_outbox",
      target_id: before.id,
      operation: "UPDATE",
      before: { ...before },
      after: { ...after },
      actor_user_id: actor,
      context: `admin_notification_${kind}`,
      reason: reason || (kind === "retry" ? "手動リトライ" : "手動キャンセル"),
      retention_class: "normal",
      strict: true,
    });
  }

  try {
    await mutateWithAudit(db, {
      mutationStatements: statements,
      expectedMutationChanges: rows.map(() => 1),
      audits,
    });
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function retryFailedNotification(
  formData: FormData,
): Promise<NotificationAdminResult> {
  const guard = await requireAdminWrite("admin_notifications");
  if (!guard.ok) return { ok: false, message: guard.message };

  const id = String(formData.get("id") ?? "").trim();
  if (!id || id.length > 128) return { ok: false, message: "idが不正です。" };

  const { db } = guard;
  const row = (
    await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)).limit(1)
  )[0];
  if (!row) return { ok: false, message: "通知が見つかりません。" };
  if (!isTerminalNotificationFailure(row.status)) {
    return { ok: false, message: `status=${row.status}はリトライ対象外です。` };
  }

  const result = await updateRows(db, [row], guard.user.id, "retry");
  if (result.ok) revalidateNotificationPages();
  return result.ok ? { ok: true, message: "通知を配信待ちに戻しました。" } : result;
}

export async function cancelNotification(
  formData: FormData,
): Promise<NotificationAdminResult> {
  const guard = await requireAdminWrite("admin_notifications");
  if (!guard.ok) return { ok: false, message: guard.message };

  const id = String(formData.get("id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!id || id.length > 128 || reason.length > 500) {
    return { ok: false, message: "入力が不正です。" };
  }

  const { db } = guard;
  const row = (
    await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)).limit(1)
  )[0];
  if (!row) return { ok: false, message: "通知が見つかりません。" };
  if (row.status === "sent" || row.status === "cancelled") {
    return { ok: false, message: `status=${row.status}はキャンセル対象外です。` };
  }

  const result = await updateRows(db, [row], guard.user.id, "cancel", reason);
  if (result.ok) revalidateNotificationPages();
  return result.ok ? { ok: true, message: "通知をキャンセルしました。" } : result;
}

export async function forceResendNotification(
  formData: FormData,
): Promise<NotificationAdminResult> {
  const guard = await requireAdminWrite("admin_notifications");
  if (!guard.ok) return { ok: false, message: guard.message };

  const id = String(formData.get("id") ?? "").trim();
  if (!id || id.length > 128) return { ok: false, message: "idが不正です。" };

  const { db } = guard;
  const source = (
    await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)).limit(1)
  )[0];
  if (!source) return { ok: false, message: "通知が見つかりません。" };

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(source.payload_json) as Record<string, unknown>;
  } catch {
    return { ok: false, message: "payloadを解析できません。" };
  }

  const batch = await buildKnownRecipientNotificationBatch(db, [
    {
      recipientUserId: source.recipient_user_id,
      type: source.type,
      payload,
      eventId: source.event_id,
      dedupeKey: `${source.dedupe_key || source.id}:force:${crypto.randomUUID()}`,
    },
  ]);
  if (batch.rows.length !== 1) {
    return { ok: false, message: "宛先の通知設定がOFF、または再送通知を構築できません。" };
  }

  try {
    await mutateWithAudit(db, {
      mutationStatements: batch.statements,
      expectedMutationChanges: batch.expectedChanges,
      audits: [
        {
          table_name: "notification_outbox",
          target_id: batch.rows[0].id,
          operation: "CREATE",
          after: { ...batch.rows[0] },
          actor_user_id: guard.user.id,
          context: "admin_notification_force_resend",
          reason: `通知${source.id}を強制再送`,
          retention_class: "normal",
          strict: true,
        },
      ],
    });
  } catch (error) {
    return failure(error);
  }

  revalidateNotificationPages();
  return { ok: true, message: "通知を再送キューに追加しました。" };
}

export async function retryAllFailedNotifications(
  _formData: FormData,
): Promise<NotificationAdminResult & { retried?: number }> {
  const guard = await requireAdminWrite("admin_notifications");
  if (!guard.ok) return { ok: false, message: guard.message };

  const { db } = guard;
  const rows = await db
    .select()
    .from(notificationOutbox)
    .where(
      inArray(notificationOutbox.status, [
        ...TERMINAL_NOTIFICATION_FAILURE_STATUSES,
      ]),
    )
    .orderBy(asc(notificationOutbox.created_at))
    .limit(BULK_RETRY_MAX + 1);
  const targets = rows.slice(0, BULK_RETRY_MAX);
  if (targets.length === 0) {
    return { ok: true, message: "失敗通知はありません。", retried: 0 };
  }

  const result = await updateRows(db, targets, guard.user.id, "retry");
  if (result.ok) revalidateNotificationPages();
  return result.ok
    ? { ok: true, message: `${targets.length}件を配信待ちに戻しました。`, retried: targets.length }
    : result;
}
