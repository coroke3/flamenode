"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import { assertCanEditEvent } from "@/lib/auth/ownership";
import { slots } from "@/lib/db/schema";
import { mutateWithAudit } from "@/lib/audit/mutate";
import { parseJstDatetimeLocal } from "@/lib/utils/dateInput";
import { generateId } from "@/lib/utils/id";
import { buildNotificationOutboxStatement } from "@/lib/notifications/enqueue";
import { buildStaticRebuildQueueBatch } from "@/lib/staticRebuild/enqueue";

export interface SlotActionResult {
  ok: boolean;
  message?: string;
  created?: number;
}

// D1 Free の 50 query / statement あたり 100 bind を超えない caller 側上限。
// 3行時の最大は条件付き slot INSERT 54 bind、strict audit INSERT 60 bind。
// batch release の最悪経路も、権限・対象・audit・notification・queue の事前 query と
// mutation/assert/audit/notification/queue の batch statement を合わせて 27 query に収まる。
const MAX_ATOMIC_SLOT_ROWS = 3;

type SlotRow = typeof slots.$inferSelect;

const batchSchema = z.object({
  event_id: z.string().trim().min(1),
  mode: z.enum(["time", "count"]),
  start_at: z.string().optional().nullable(),
  end_at: z.string().optional().nullable(),
  interval_minutes: z.coerce.number().min(1).max(60 * 24).default(5),
  count: z.coerce.number().min(1).max(MAX_ATOMIC_SLOT_ROWS).default(1),
  label_prefix: z.string().trim().max(40).optional().nullable(),
  start_index: z.coerce.number().min(0).max(9999).default(1),
});

function parseDateInput(raw: string | null | undefined): number | null {
  return parseJstDatetimeLocal(raw);
}

function revalidateEventSlotPaths(eventId: string): void {
  revalidatePath(`/manage/events/${eventId}/slots`);
  revalidatePath(`/manage/events/${eventId}`);
  revalidatePath(`/manage`);
  revalidatePath(`/admin/events/${eventId}/slots`);
  revalidatePath(`/admin/events/${eventId}`);
  revalidatePath(`/event/${eventId}`);
}

function snapshot(row: SlotRow): Record<string, unknown> {
  return { ...row };
}

function versionedWhere(
  eventId: string,
  rows: readonly SlotRow[],
  status?: "available" | "reserved" | "submitted",
) {
  const versions = or(
    ...rows.map((row) =>
      and(
        eq(slots.id, row.id),
        eq(slots.version, row.version),
        eq(slots.updated_at, row.updated_at),
      ),
    ),
  );
  return and(
    eq(slots.event_id, eventId),
    status ? eq(slots.status, status) : undefined,
    versions,
  )!;
}

function uniqueIds(ids: readonly string[]): boolean {
  return new Set(ids).size === ids.length;
}

function parseSlotIds(formData: FormData): string[] {
  const raw = String(formData.get("slot_ids") ?? "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((id) => String(id).trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function ensureCanEditSlots(eventId: string): Promise<
  | { ok: true; userId: string }
  | { ok: false; result: SlotActionResult }
> {
  const session = await auth().catch(() => null);
  const u = session?.user as { id?: string; role?: string } | undefined;
  if (!u?.id) return { ok: false, result: { ok: false, message: "ログインが必要です。" } };
  const db = getDatabase();
  if (!db) return { ok: false, result: { ok: false, message: "DB に接続できません。" } };
  try {
    await assertCanEditEvent(db, { id: u.id, role: u.role ?? null }, eventId, "event.slots");
  } catch (error) {
    return {
      ok: false,
      result: { ok: false, message: error instanceof Error ? error.message : "権限がありません。" },
    };
  }
  return { ok: true, userId: u.id };
}

function mutationError(error: unknown): SlotActionResult {
  return {
    ok: false,
    message: error instanceof Error ? `スロット更新を取り消しました: ${error.message}` : "スロット更新を取り消しました。",
  };
}

async function buildEventQueueBatch(
  db: NonNullable<ReturnType<typeof getDatabase>>,
  eventId: string,
  reason: string,
  requestedByUserId: string,
) {
  return buildStaticRebuildQueueBatch(db, [{
    targetType: "event",
    targetId: eventId,
    reason,
    priority: "high",
    requestedByUserId,
  }]);
}

async function buildReleaseNotification(
  db: NonNullable<ReturnType<typeof getDatabase>>,
  row: SlotRow,
  targetIds: readonly string[],
  groupId: string | null,
) {
  if (!row.reserved_by_user_id) return null;
  return buildNotificationOutboxStatement(db, {
    recipientUserId: row.reserved_by_user_id,
    type: "slot_force_released",
    dedupeKey: `slot_force_released:${row.event_id}:${row.id}:${groupId ?? "solo"}`,
    payload: {
      content: `運営によりイベント枠 (${targetIds.length}件) が解放されました。`,
      slot_ids: [...targetIds],
      event_id: row.event_id,
      reservation_group_id: groupId,
    },
    eventId: row.event_id,
  });
}

/** スロット一括生成。生成行・監査・通知を一つの D1 batch にする。 */
export async function generateSlotsBatch(formData: FormData): Promise<SlotActionResult> {
  const parsed = batchSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "入力エラー" };
  const data = parsed.data;
  const guard = await ensureCanEditSlots(data.event_id);
  if (!guard.ok) return guard.result;
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const now = Math.floor(Date.now() / 1000);
  const newRows: SlotRow[] = [];
  if (data.mode === "time") {
    const startTs = parseDateInput(data.start_at);
    const endTs = parseDateInput(data.end_at);
    if (!startTs || !endTs || endTs <= startTs) return { ok: false, message: "開始・終了日時を正しく指定してください。" };
    const intervalSec = data.interval_minutes * 60;
    for (let cursor = startTs, order = 0; cursor + intervalSec <= endTs; cursor += intervalSec, order += 1) {
      if (newRows.length >= MAX_ATOMIC_SLOT_ROWS) return { ok: false, message: `一度に作成できる枠は ${MAX_ATOMIC_SLOT_ROWS} 件までです。` };
      newRows.push({
        id: generateId("slot"), event_id: data.event_id, reserved_by_user_id: null, x_user_id: null,
        display_name: null, slot_kind: "time", slot_label: null, start_time: cursor, sort_order: order,
        reservation_group_id: null, priority_reclaim_video_id: null, priority_reclaim_until: null, video_id: null,
        status: "available", updated_at: now, version: 1,
      });
    }
  } else {
    if (data.count > MAX_ATOMIC_SLOT_ROWS) return { ok: false, message: `一度に作成できる枠は ${MAX_ATOMIC_SLOT_ROWS} 件までです。` };
    const prefix = (data.label_prefix ?? "").trim() || "No.";
    const startIndex = Math.max(1, data.start_index || 1);
    for (let i = 0; i < data.count; i += 1) {
      const sortOrder = startIndex + i;
      newRows.push({
        id: generateId("slot"), event_id: data.event_id, reserved_by_user_id: null, x_user_id: null,
        display_name: null, slot_kind: "count", slot_label: `${prefix}${sortOrder}`, start_time: null, sort_order: sortOrder,
        reservation_group_id: null, priority_reclaim_video_id: null, priority_reclaim_until: null, video_id: null,
        status: "available", updated_at: now, version: 1,
      });
    }
  }
  if (newRows.length === 0) return { ok: false, message: "作成対象の枠がありません。" };

  const conflictRows = await db.select({ id: slots.id }).from(slots).where(
    and(
      eq(slots.event_id, data.event_id),
      data.mode === "time"
        ? inArray(slots.start_time, newRows.map((row) => row.start_time).filter((value): value is number => value !== null))
        : inArray(slots.sort_order, newRows.map((row) => row.sort_order).filter((value): value is number => value !== null)),
    )!,
  );
  if (conflictRows.length > 0) return { ok: false, message: "同じ時刻または順序の枠が既に存在します。" };

  const slotColumns = sql.raw("id, event_id, reserved_by_user_id, x_user_id, display_name, slot_kind, slot_label, start_time, sort_order, reservation_group_id, priority_reclaim_video_id, priority_reclaim_until, video_id, status, updated_at, version");
  const insertCandidates = sql.join(
    newRows.map((row) => sql`
      SELECT ${row.id}, ${row.event_id}, ${row.reserved_by_user_id}, ${row.x_user_id}, ${row.display_name},
             ${row.slot_kind}, ${row.slot_label}, ${row.start_time}, ${row.sort_order}, ${row.reservation_group_id},
             ${row.priority_reclaim_video_id}, ${row.priority_reclaim_until}, ${row.video_id}, ${row.status},
             ${row.updated_at}, ${row.version}
      WHERE NOT EXISTS (
        SELECT 1 FROM slots
        WHERE event_id = ${row.event_id}
          AND ${data.mode === "time" ? sql`start_time = ${row.start_time}` : sql`sort_order = ${row.sort_order}`}
      )
    `),
    sql` UNION ALL `,
  );
  const insert = db.run(sql`INSERT INTO slots (${slotColumns}) ${insertCandidates}`);
  const queueBatch = await buildEventQueueBatch(db, data.event_id, "slot_admin_generate", guard.userId);
  try {
    await mutateWithAudit(db, {
      mutationStatements: [insert, ...queueBatch.statements],
      expectedMutationChanges: [newRows.length, ...queueBatch.expectedChanges],
      audits: newRows.map((row) => ({ table_name: "slots", target_id: row.id, operation: "CREATE", after: snapshot(row), actor_user_id: guard.userId, retention_class: "normal", strict: true })),
    });
  } catch (error) {
    return mutationError(error);
  }
  revalidateEventSlotPaths(data.event_id);
  return { ok: true, created: newRows.length };
}

/** available 枠を一括削除。snapshot/CAS/audit を一つの D1 batch にする。 */
export async function deleteAvailableSlots(formData: FormData): Promise<SlotActionResult> {
  const eventId = String(formData.get("event_id") ?? "").trim();
  if (!eventId) return { ok: false, message: "event_id が必要です。" };
  const guard = await ensureCanEditSlots(eventId);
  if (!guard.ok) return guard.result;
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
  const rows = await db
    .select()
    .from(slots)
    .where(and(eq(slots.event_id, eventId), eq(slots.status, "available"))!)
    .limit(MAX_ATOMIC_SLOT_ROWS + 1);
  if (rows.length === 0) return { ok: true, created: 0 };
  if (rows.length > MAX_ATOMIC_SLOT_ROWS) return { ok: false, message: `一度に処理できる枠は ${MAX_ATOMIC_SLOT_ROWS} 件までです。` };
  const queueBatch = await buildEventQueueBatch(db, eventId, "slot_admin_delete_available", guard.userId);
  try {
    await mutateWithAudit(db, {
      mutationStatements: [db.delete(slots).where(versionedWhere(eventId, rows, "available")), ...queueBatch.statements],
      expectedMutationChanges: [rows.length, ...queueBatch.expectedChanges],
      audits: rows.map((row) => ({ table_name: "slots", target_id: row.id, operation: "DELETE", before: snapshot(row), actor_user_id: guard.userId, retention_class: "normal", strict: true })),
    });
  } catch (error) { return mutationError(error); }
  revalidateEventSlotPaths(eventId);
  return { ok: true, created: rows.length };
}

/** 単体または reservation_group 全体を、全行snapshot/CAS付きで解放する。 */
export async function releaseSlot(formData: FormData): Promise<SlotActionResult> {
  const slotId = String(formData.get("slot_id") ?? "").trim();
  if (!slotId) return { ok: false, message: "slot_id が必要です。" };
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
  const row = await db.select().from(slots).where(eq(slots.id, slotId)).limit(1).then((r) => r[0]);
  if (!row) return { ok: false, message: "枠が見つかりません。" };
  const guard = await ensureCanEditSlots(row.event_id);
  if (!guard.ok) return guard.result;
  const groupId = row.reservation_group_id?.trim() || null;
  const rows = groupId
    ? await db
        .select()
        .from(slots)
        .where(and(eq(slots.event_id, row.event_id), eq(slots.reservation_group_id, groupId), row.reserved_by_user_id ? eq(slots.reserved_by_user_id, row.reserved_by_user_id) : isNull(slots.reserved_by_user_id), row.x_user_id ? eq(slots.x_user_id, row.x_user_id) : isNull(slots.x_user_id))!)
        .limit(MAX_ATOMIC_SLOT_ROWS + 1)
    : [row];
  if (rows.length === 0 || rows.some((candidate) => candidate.status !== "reserved")) return { ok: false, message: "対象グループ全体が予約中ではありません。" };
  if (rows.length > MAX_ATOMIC_SLOT_ROWS) return { ok: false, message: `一度に解放できる枠は ${MAX_ATOMIC_SLOT_ROWS} 件までです。` };
  const now = Math.floor(Date.now() / 1000);
  const after = (candidate: SlotRow): Record<string, unknown> => ({ ...candidate, status: "available", reserved_by_user_id: null, x_user_id: null, display_name: null, reservation_group_id: null, video_id: null, updated_at: now, version: candidate.version + 1 });
  const targetIds = rows.map((candidate) => candidate.id);
  const notification = await buildReleaseNotification(db, row, targetIds, groupId);
  const queueBatch = await buildEventQueueBatch(db, row.event_id, "slot_admin_release", guard.userId);
  try {
    await mutateWithAudit(db, {
      mutationStatements: [db.update(slots).set({ status: "available", reserved_by_user_id: null, x_user_id: null, display_name: null, reservation_group_id: null, video_id: null, updated_at: now, version: sql`${slots.version} + 1` }).where(versionedWhere(row.event_id, rows, "reserved")), ...queueBatch.statements],
      expectedMutationChanges: [rows.length, ...queueBatch.expectedChanges],
      audits: rows.map((candidate) => ({ table_name: "slots", target_id: candidate.id, operation: "UPDATE", before: snapshot(candidate), after: after(candidate), actor_user_id: guard.userId, retention_class: "long_audit", strict: true })),
      postAuditStatements: notification ? [notification] : [],
    });
  } catch (error) { return mutationError(error); }
  revalidateEventSlotPaths(row.event_id);
  return { ok: true };
}

/** available 枠を一件削除する単一batch版。 */
export async function deleteSlot(formData: FormData): Promise<SlotActionResult> {
  const slotId = String(formData.get("slot_id") ?? "").trim();
  if (!slotId) return { ok: false, message: "slot_id が必要です。" };
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
  const row = await db.select().from(slots).where(eq(slots.id, slotId)).limit(1).then((r) => r[0]);
  if (!row) return { ok: false, message: "枠が見つかりません。" };
  if (row.status !== "available") return { ok: false, message: "予約済み・投稿済みの枠は削除できません。" };
  const guard = await ensureCanEditSlots(row.event_id);
  if (!guard.ok) return guard.result;
  const queueBatch = await buildEventQueueBatch(db, row.event_id, "slot_admin_delete", guard.userId);
  try {
    await mutateWithAudit(db, {
      mutationStatements: [db.delete(slots).where(versionedWhere(row.event_id, [row], "available")), ...queueBatch.statements],
      expectedMutationChanges: [1, ...queueBatch.expectedChanges],
      audits: [{ table_name: "slots", target_id: row.id, operation: "DELETE", before: snapshot(row), actor_user_id: guard.userId, retention_class: "normal", strict: true }],
    });
  } catch (error) { return mutationError(error); }
  revalidateEventSlotPaths(row.event_id);
  return { ok: true };
}

/** 選択された available 枠を一括削除する。 */
export async function batchDeleteAvailableSlots(formData: FormData): Promise<SlotActionResult> {
  const eventId = String(formData.get("event_id") ?? "").trim();
  const slotIds = parseSlotIds(formData);
  if (!eventId || slotIds.length === 0) return { ok: false, message: "event_id と枠を指定してください。" };
  if (!uniqueIds(slotIds) || slotIds.length > MAX_ATOMIC_SLOT_ROWS) return { ok: false, message: `重複を除く ${MAX_ATOMIC_SLOT_ROWS} 件以内で指定してください。` };
  const guard = await ensureCanEditSlots(eventId);
  if (!guard.ok) return guard.result;
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
  const rows = await db.select().from(slots).where(and(eq(slots.event_id, eventId), inArray(slots.id, slotIds))!);
  if (rows.length !== slotIds.length || rows.some((row) => row.status !== "available")) return { ok: false, message: "対象に available 以外または存在しない枠があります。" };
  const queueBatch = await buildEventQueueBatch(db, eventId, "slot_admin_batch_delete", guard.userId);
  try {
    await mutateWithAudit(db, {
      mutationStatements: [db.delete(slots).where(versionedWhere(eventId, rows, "available")), ...queueBatch.statements],
      expectedMutationChanges: [rows.length, ...queueBatch.expectedChanges],
      audits: rows.map((row) => ({ table_name: "slots", target_id: row.id, operation: "DELETE", before: snapshot(row), actor_user_id: guard.userId, retention_class: "normal", strict: true })),
    });
  } catch (error) { return mutationError(error); }
  revalidateEventSlotPaths(eventId);
  return { ok: true, message: `${rows.length}件の空き枠を削除しました。` };
}

/** 選択枠とその reservation_group 全体を一括解放する。 */
export async function batchReleaseReservedSlots(formData: FormData): Promise<SlotActionResult> {
  const eventId = String(formData.get("event_id") ?? "").trim();
  const slotIds = parseSlotIds(formData);
  if (!eventId || slotIds.length === 0) return { ok: false, message: "event_id と枠を指定してください。" };
  if (!uniqueIds(slotIds) || slotIds.length > MAX_ATOMIC_SLOT_ROWS) return { ok: false, message: `重複を除く ${MAX_ATOMIC_SLOT_ROWS} 件以内で指定してください。` };
  const guard = await ensureCanEditSlots(eventId);
  if (!guard.ok) return guard.result;
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
  const selected = await db.select().from(slots).where(and(eq(slots.event_id, eventId), inArray(slots.id, slotIds))!);
  if (selected.length !== slotIds.length || selected.some((row) => row.status !== "reserved")) return { ok: false, message: "対象に予約中以外または存在しない枠があります。" };
  const groupIds = [...new Set(selected.map((row) => row.reservation_group_id).filter((id): id is string => Boolean(id)))];
  const grouped = groupIds.length > 0
    ? await db
        .select()
        .from(slots)
        .where(and(eq(slots.event_id, eventId), inArray(slots.reservation_group_id, groupIds))!)
        .limit(MAX_ATOMIC_SLOT_ROWS + 1)
    : [];
  const byId = new Map<string, SlotRow>(selected.map((row) => [row.id, row]));
  for (const row of grouped) byId.set(row.id, row);
  const rows = [...byId.values()];
  if (rows.length > MAX_ATOMIC_SLOT_ROWS) return { ok: false, message: `reservation_group を含む処理対象は ${MAX_ATOMIC_SLOT_ROWS} 件以内にしてください。` };
  if (rows.some((row) => row.status !== "reserved")) return { ok: false, message: "reservation_group 全体が予約中ではありません。" };
  const notifications: BatchItem<"sqlite">[] = [];
  for (const groupId of groupIds) {
    const representative = rows.find((row) => row.reservation_group_id === groupId);
    if (representative) {
      const statement = await buildReleaseNotification(
        db,
        representative,
        rows.filter((row) => row.reservation_group_id === groupId).map((row) => row.id),
        groupId,
      );
      if (statement) notifications.push(statement);
    }
  }
  for (const row of selected.filter((candidate) => !candidate.reservation_group_id)) {
    const statement = await buildReleaseNotification(db, row, [row.id], null);
    if (statement) notifications.push(statement);
  }
  const now = Math.floor(Date.now() / 1000);
  const queueBatch = await buildEventQueueBatch(db, eventId, "slot_admin_batch_release", guard.userId);
  try {
    await mutateWithAudit(db, {
      mutationStatements: [db.update(slots).set({ status: "available", x_user_id: null, reserved_by_user_id: null, display_name: null, reservation_group_id: null, video_id: null, updated_at: now, version: sql`${slots.version} + 1` }).where(versionedWhere(eventId, rows, "reserved")), ...queueBatch.statements],
      expectedMutationChanges: [rows.length, ...queueBatch.expectedChanges],
      audits: rows.map((row) => ({ table_name: "slots", target_id: row.id, operation: "UPDATE", before: snapshot(row), after: { ...snapshot(row), status: "available", x_user_id: null, reserved_by_user_id: null, display_name: null, reservation_group_id: null, video_id: null, updated_at: now, version: row.version + 1 }, actor_user_id: guard.userId, retention_class: "long_audit", strict: true })),
      postAuditStatements: notifications,
    });
  } catch (error) { return mutationError(error); }
  revalidateEventSlotPaths(eventId);
  return { ok: true, message: `${rows.length}件の予約枠を解放しました。` };
}

/** 選択枠のラベルを一括更新する。 */
export async function batchUpdateSlotLabels(formData: FormData): Promise<SlotActionResult> {
  const eventId = String(formData.get("event_id") ?? "").trim();
  const slotIds = parseSlotIds(formData);
  const label = String(formData.get("label") ?? "").trim();
  if (!eventId || slotIds.length === 0 || !label) return { ok: false, message: "event_id・枠・ラベルを指定してください。" };
  if (label.length > 200 || !uniqueIds(slotIds) || slotIds.length > MAX_ATOMIC_SLOT_ROWS) return { ok: false, message: `ラベルまたは件数の上限を超えています。` };
  const guard = await ensureCanEditSlots(eventId);
  if (!guard.ok) return guard.result;
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
  const rows = await db.select().from(slots).where(and(eq(slots.event_id, eventId), inArray(slots.id, slotIds))!);
  if (rows.length !== slotIds.length) return { ok: false, message: "存在しない枠が含まれています。" };
  const now = Math.floor(Date.now() / 1000);
  const queueBatch = await buildEventQueueBatch(db, eventId, "slot_admin_label_update", guard.userId);
  try {
    await mutateWithAudit(db, {
      mutationStatements: [db.update(slots).set({ slot_label: label, updated_at: now, version: sql`${slots.version} + 1` }).where(versionedWhere(eventId, rows)), ...queueBatch.statements],
      expectedMutationChanges: [rows.length, ...queueBatch.expectedChanges],
      audits: rows.map((row) => ({ table_name: "slots", target_id: row.id, operation: "UPDATE", before: snapshot(row), after: { ...snapshot(row), slot_label: label, updated_at: now, version: row.version + 1 }, actor_user_id: guard.userId, retention_class: "normal", strict: true })),
    });
  } catch (error) { return mutationError(error); }
  revalidateEventSlotPaths(eventId);
  return { ok: true, message: `${rows.length}件のラベルを更新しました。` };
}
