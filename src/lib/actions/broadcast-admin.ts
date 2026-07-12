"use server";
import { auditAction } from "@/lib/audit/helpers";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import { users as usersTable, xUsers as xUsersTable } from "@/lib/db/schema";
import { enqueueNotification } from "@/lib/notifications/enqueue";

export interface BroadcastResult {
  ok: boolean;
  message?: string;
  enqueued?: number;
  cursor?: number;
}

/**
 * 段階 broadcast enqueue (Opus #7 安全実装)。
 *
 * - admin 限定
 * - 1 回の呼び出しで最大 BROADCAST_BATCH_SIZE (50) 件のみ enqueue
 * - OFFSET ベースで段階実行 (UI から「次の 50 件」ボタンで進める)
 * - target_audience に応じて宛先を切り替え
 * - notification_outbox に type='announcement_broadcast' で挿入
 * - audit_logs にバッチ件数を記録
 *
 * 完全な broadcast は複数回呼び出して進める。本実装はあくまで「安全に
 * 段階配信する」ためのもので、誤実行による全件通知を防ぐ。
 */
const BROADCAST_BATCH_SIZE = 50;
const BROADCAST_MAX_CONTENT_LEN = 1000;

export async function broadcastAnnouncement(
  formData: FormData,
): Promise<BroadcastResult> {
  const session = await auth().catch(() => null);
  const u = session?.user as { id?: string; role?: string } | undefined;
  if (!u?.id || u.role !== "admin") {
    return { ok: false, message: "admin のみ実行できます。" };
  }

  const announcementId = String(formData.get("announcement_id") ?? "").trim();
  const audienceRaw = String(formData.get("audience") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim().slice(0, BROADCAST_MAX_CONTENT_LEN);
  const cursorRaw = Number(formData.get("cursor") ?? 0);
  const cursor = Number.isFinite(cursorRaw) && cursorRaw >= 0 ? Math.floor(cursorRaw) : 0;
  const confirm = String(formData.get("confirm") ?? "").trim();

  if (!announcementId) return { ok: false, message: "announcement_id が必要です。" };
  if (!content) return { ok: false, message: "content が空です。" };
  if (confirm !== "BROADCAST") {
    return { ok: false, message: "確認文字列 'BROADCAST' が一致しません。" };
  }

  const audience: "all" | "creators" | "admins" =
    audienceRaw === "all" || audienceRaw === "creators" || audienceRaw === "admins"
      ? audienceRaw
      : "creators";

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  // 対象内部ユーザー ID を audience に応じてバッチ取得 (cursor から BROADCAST_BATCH_SIZE 件)
  let targets: { user_id: string }[] = [];
  if (audience === "all") {
    targets = await db
      .select({ user_id: usersTable.id })
      .from(usersTable)
      .orderBy(usersTable.id)
      .limit(BROADCAST_BATCH_SIZE)
      .offset(cursor);
  } else if (audience === "admins") {
    targets = await db
      .select({ user_id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.role, "admin"))
      .orderBy(usersTable.id)
      .limit(BROADCAST_BATCH_SIZE)
      .offset(cursor);
  } else {
    // creators: approved X ID を持つ distinct user_id
    const rows = await db
      .selectDistinct({ user_id: xUsersTable.linked_user_id })
      .from(xUsersTable)
      .where(eq(xUsersTable.approval_status, "approved"))
      .orderBy(xUsersTable.linked_user_id)
      .limit(BROADCAST_BATCH_SIZE)
      .offset(cursor);
    targets = rows.filter((r) => r.user_id != null) as {
      user_id: string;
    }[];
  }

  if (targets.length === 0) {
    return {
      ok: true,
      message: "対象が 0 件です。全件配信完了済か、cursor が終端を超えています。",
      enqueued: 0,
      cursor,
    };
  }

  let enqueued = 0;
  for (const t of targets) {
    if (!t.user_id) continue;
    const ok = await enqueueNotification(db, {
      recipientUserId: t.user_id,
      type: "announcement_broadcast",
      payload: {
        content,
        announcement_id: announcementId,
        broadcast: true,
      },
      eventId: null,
    });
    if (ok) {
      enqueued += 1;
    }
  }

  // 監査ログ
  const now = Math.floor(Date.now() / 1000);
  await auditAction(db, {
    table_name: "announcements",
    record_id: announcementId,
    action: "UPDATE",
    after_data: JSON.stringify({
      broadcast_batch: true,
      audience,
      cursor,
      enqueued,
      executor: u.id,
    }),
    operator_user_id: u.id,
    retention_class: "long_audit",
  });

  revalidatePath("/admin/notifications");
  revalidatePath("/admin/announcements");

  const nextCursor = cursor + targets.length;
  return {
    ok: true,
    message: `${enqueued} 件 enqueue しました (audience=${audience}, cursor=${cursor}→${nextCursor})。続きがあれば cursor=${nextCursor} で再実行してください。`,
    enqueued,
    cursor: nextCursor,
  };
}
