"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gt } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDatabase } from "@/lib/cloudflare";
import {
  announcements,
  users,
  xUsers,
} from "@/lib/db/schema";
import { requireAdminWrite } from "@/lib/auth/writeGuard";
import { expectedRowCondition } from "@/lib/audit/adapters";
import { mutateWithAudit, planD1AuditMutationBudget } from "@/lib/audit/mutate";
import { buildKnownRecipientNotificationBatch } from "@/lib/notifications/enqueue";

export interface BroadcastResult {
  ok: boolean;
  message?: string;
  enqueued?: number;
  cursor?: string;
}

const BROADCAST_BATCH_SIZE = 30;
const BROADCAST_MAX_CONTENT_LEN = 1000;
const BROADCAST_MAX_ID_LEN = 128;
type Audience = "all" | "creators" | "admins";

function snapshot(row: object): Record<string, unknown> { return { ...row }; }
function errorResult(error: unknown): BroadcastResult {
  console.error("[broadcast-admin] atomic mutation failed", error);
  return { ok: false, message: "配信登録が競合したか、通知・監査記録に失敗しました。再読み込みしてください。" };
}

export async function broadcastAnnouncement(formData: FormData): Promise<BroadcastResult> {
  const guard = await requireAdminWrite("admin_announcement_broadcast");
  if (!guard.ok) return { ok: false, message: guard.message };

  const announcementId = String(formData.get("announcement_id") ?? "").trim();
  const audienceRaw = String(formData.get("audience") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  const cursor = String(formData.get("cursor") ?? "").trim();
  const confirm = String(formData.get("confirm") ?? "").trim();
  if (!announcementId || announcementId.length > BROADCAST_MAX_ID_LEN) return { ok: false, message: "announcement_idが不正です。" };
  if (!content || content.length > BROADCAST_MAX_CONTENT_LEN) return { ok: false, message: `contentは1〜${BROADCAST_MAX_CONTENT_LEN}文字で指定してください。` };
  if (cursor.length > BROADCAST_MAX_ID_LEN) return { ok: false, message: "cursorが長すぎます。" };
  if (confirm !== "BROADCAST") return { ok: false, message: "確認文字列BROADCASTが一致しません。" };
  if (audienceRaw !== "all" && audienceRaw !== "creators" && audienceRaw !== "admins") return { ok: false, message: "audienceが不正です。" };
  const audience: Audience = audienceRaw;

  const db = getDatabase();
  if (!db) return { ok: false, message: "DBに接続できません。" };
  const before = (await db.select().from(announcements).where(eq(announcements.id, announcementId)).limit(1))[0];
  if (!before) return { ok: false, message: "対象のお知らせが見つかりません。" };

  const baseConditions = [
    eq(users.is_notification_enabled, 1),
    ...(cursor ? [gt(users.id, cursor)] : []),
  ];
  let rows: { user_id: string }[];
  if (audience === "all") {
    rows = await db.select({ user_id: users.id }).from(users)
      .where(and(...baseConditions)!).orderBy(users.id).limit(BROADCAST_BATCH_SIZE + 1);
  } else if (audience === "admins") {
    rows = await db.select({ user_id: users.id }).from(users)
      .where(and(...baseConditions, eq(users.role, "admin"))!).orderBy(users.id).limit(BROADCAST_BATCH_SIZE + 1);
  } else {
    rows = await db.selectDistinct({ user_id: users.id }).from(users)
      .innerJoin(xUsers, and(eq(xUsers.linked_user_id, users.id), eq(xUsers.approval_status, "approved"))!)
      .where(and(...baseConditions)!).orderBy(users.id).limit(BROADCAST_BATCH_SIZE + 1);
  }
  const targets = rows.slice(0, BROADCAST_BATCH_SIZE);
  const targetIds = targets.map((row) => row.user_id);
  const nextCursor = targetIds.at(-1) ?? cursor;
  const notifications = await buildKnownRecipientNotificationBatch(db, targetIds.map((userId) => ({
    recipientUserId: userId,
    type: "announcement_broadcast",
    payload: { content, announcement_id: announcementId, broadcast: true },
    eventId: null,
    dedupeKey: `announcement_broadcast:${announcementId}:${userId}`,
  })));

  const now = Math.max(Math.floor(Date.now() / 1000), before.updated_at + 1);
  const after = { ...before, updated_at: now };
  const statements: BatchItem<"sqlite">[] = [
    db.update(announcements).set({ updated_at: now }).where(and(
      eq(announcements.id, announcementId),
      expectedRowCondition({ expectedCurrent: snapshot(before) }),
    )!),
    ...notifications.statements,
  ];
  const expected: (number | null)[] = [1, ...notifications.expectedChanges];
  const budget = planD1AuditMutationBudget({
    mutationStatementCount: statements.length,
    mutationAssertionCount: 1,
    auditEntryCount: 1,
    distinctActorCount: 1,
  });
  if (!budget.withinLimit) return { ok: false, message: "通知件数がD1処理上限を超えます。" };
  const auditMetadata = JSON.stringify({
    audience,
    cursor,
    next_cursor: nextCursor,
    target_user_ids: targetIds,
    target_count: targetIds.length,
    enqueued_count: notifications.statements.length,
    has_more: rows.length > BROADCAST_BATCH_SIZE,
  });
  try {
    await mutateWithAudit(db, {
      mutationStatements: statements,
      expectedMutationChanges: expected,
      audits: [{
        table_name: "announcements",
        target_id: announcementId,
        operation: "UPDATE",
        before: snapshot(before),
        after: snapshot(after),
        actor_user_id: guard.user.id,
        reason: auditMetadata,
        context: "announcement_broadcast",
        retention_class: "long_audit",
        strict: true,
      }],
    });
  } catch (error) { return errorResult(error); }

  revalidatePath("/admin/notifications");
  revalidatePath("/admin/announcements");
  return {
    ok: true,
    message: `${notifications.statements.length}件を登録しました（対象${targetIds.length}件、audience=${audience}）。`,
    enqueued: notifications.statements.length,
    cursor: nextCursor,
  };
}
