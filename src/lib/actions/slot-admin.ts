"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDatabase } from "@/lib/cloudflare";
import { assertCanEditEvent } from "@/lib/auth/ownership";
import { writeGuard } from "@/lib/auth/writeGuard";
import { slots } from "@/lib/db/schema";
import { mutateWithAudit } from "@/lib/audit/mutate";
import { parseJstDatetimeLocal } from "@/lib/utils/dateInput";
import { generateId } from "@/lib/utils/id";
import { buildNotificationOutboxStatement } from "@/lib/notifications/enqueue";
import { buildStaticRebuildQueueBatch } from "@/lib/staticRebuild/enqueue";
import { MAX_ATOMIC_SLOT_ROWS } from "@/lib/slots/atomicLimits";

export interface SlotActionResult {
  ok: boolean;
  message?: string;
  created?: number;
}

type DB = NonNullable<ReturnType<typeof getDatabase>>;
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

function revalidateEventSlotPaths(eventId: string): void {
  revalidatePath(`/manage/events/${eventId}/slots`);
  revalidatePath(`/manage/events/${eventId}`);
  revalidatePath("/manage");
  revalidatePath(`/admin/events/${eventId}/slots`);
  revalidatePath(`/admin/events/${eventId}`);
  revalidatePath(`/event/${eventId}`);
  revalidatePath(`/event/${eventId}/slots`);
}

function snapshot(row: SlotRow): Record<string, unknown> {
  return { ...row };
}

function versionedWhere(
  eventId: string,
  rows: readonly SlotRow[],
  status?: "available" | "reserved" | "submitted",
) {
  return and(
    eq(slots.event_id, eventId),
    status ? eq(slots.status, status) : undefined,
    or(
      ...rows.map((row) =>
        and(
          eq(slots.id, row.id),
          eq(slots.version, row.version),
          eq(slots.updated_at, row.updated_at),
        ),
      ),
    ),
  )!;
}

function parseSlotIds(formData: FormData): string[] {
  const raw = String(formData.get("slot_ids") ?? "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? Array.from(new Set(parsed.map((id) => String(id).trim()).filter(Boolean)))
      : [];
  } catch {
    return [];
  }
}

async function ensureCanEditSlots(
  eventId: string,
  feature:
    | "manage_slot_create"
    | "manage_slot_update"
    | "manage_slot_delete",
): Promise<
  | { ok: true; userId: string; db: DB }
  | { ok: false; result: SlotActionResult }
> {
  const guard = await writeGuard({ feature });
  if (!guard.ok) {
    return { ok: false, result: { ok: false, message: guard.message } };
  }
  const db = getDatabase();
  if (!db) {
    return { ok: false, result: { ok: false, message: "DB に接続できません。" } };
  }
  try {
    await assertCanEditEvent(
      db,
      { id: guard.user.id, role: guard.user.role ?? null },
      eventId,
      "event.slots",
    );
  } catch (error) {
    return {
      ok: false,
      result: {
        ok: false,
        message: error instanceof Error ? error.message : "権限がありません。",
      },
    };
  }
  return { ok: true, userId: guard.user.id, db };
}

function mutationError(error: unknown): SlotActionResult {
  return {
    ok: false,
    message:
      error instanceof Error
        ? `スロット更新を取り消しました: ${error.message}`
        : "スロット更新を取り消しました。",
  };
}

async function eventQueue(
  db: DB,
  eventId: string,
  reason: string,
  userId: string,
) {
  return buildStaticRebuildQueueBatch(db, [
    {
      targetType: "event",
      targetId: eventId,
      reason,
      priority: "high",
      requestedByUserId: userId,
    },
  ]);
}

async function releaseNotification(
  db: DB,
  row: SlotRow,
): Promise<BatchItem<"sqlite"> | null> {
  if (!row.reserved_by_user_id) return null;
  return buildNotificationOutboxStatement(db, {
    recipientUserId: row.reserved_by_user_id,
    type: "slot_force_released",
    dedupeKey: `slot_force_released:${row.event_id}:${row.id}:${row.version}`,
    payload: {
      content: "運営によりイベント枠が解放されました。",
      slot_ids: [row.id],
      event_id: row.event_id,
      reservation_group_id: null,
    },
    eventId: row.event_id,
  });
}

export async function generateSlotsBatch(
  formData: FormData,
): Promise<SlotActionResult> {
  const parsed = batchSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "入力エラー" };
  }
  const data = parsed.data;
  const guard = await ensureCanEditSlots(data.event_id, "manage_slot_create");
  if (!guard.ok) return guard.result;

  const now = Math.floor(Date.now() / 1000);
  const newRows: SlotRow[] = [];
  if (data.mode === "time") {
    const start = parseJstDatetimeLocal(data.start_at);
    const end = parseJstDatetimeLocal(data.end_at);
    if (!start || !end || end <= start) {
      return { ok: false, message: "開始・終了日時を正しく指定してください。" };
    }
    const interval = data.interval_minutes * 60;
    for (let cursor = start, order = 0; cursor + interval <= end; cursor += interval) {
      if (newRows.length >= MAX_ATOMIC_SLOT_ROWS) {
        return {
          ok: false,
          message: `一度に作成できる枠は ${MAX_ATOMIC_SLOT_ROWS} 件までです。`,
        };
      }
      newRows.push({
        id: generateId("slot"),
        event_id: data.event_id,
        reserved_by_user_id: null,
        x_user_id: null,
        display_name: null,
        slot_label: null,
        start_time: cursor,
        sort_order: order++,
        reservation_group_id: null,
        video_id: null,
        status: "available",
        updated_at: now,
        version: 1,
      });
    }
  } else {
    const prefix = data.label_prefix?.trim() || "No.";
    const startIndex = Math.max(1, data.start_index || 1);
    for (let index = 0; index < data.count; index += 1) {
      const order = startIndex + index;
      newRows.push({
        id: generateId("slot"),
        event_id: data.event_id,
        reserved_by_user_id: null,
        x_user_id: null,
        display_name: null,
        slot_label: `${prefix}${order}`,
        start_time: null,
        sort_order: order,
        reservation_group_id: null,
        video_id: null,
        status: "available",
        updated_at: now,
        version: 1,
      });
    }
  }
  if (newRows.length === 0) {
    return { ok: false, message: "作成対象の枠がありません。" };
  }

  const conflicts = await guard.db
    .select({ id: slots.id })
    .from(slots)
    .where(
      and(
        eq(slots.event_id, data.event_id),
        data.mode === "time"
          ? inArray(
              slots.start_time,
              newRows
                .map((row) => row.start_time)
                .filter((value): value is number => value !== null),
            )
          : inArray(
              slots.sort_order,
              newRows
                .map((row) => row.sort_order)
                .filter((value): value is number => value !== null),
            ),
      )!,
    );
  if (conflicts.length > 0) {
    return { ok: false, message: "同じ時刻または順序の枠が既に存在します。" };
  }

  const queue = await eventQueue(
    guard.db,
    data.event_id,
    "slot_admin_generate",
    guard.userId,
  );
  try {
    await mutateWithAudit(guard.db, {
      mutationStatements: [guard.db.insert(slots).values(newRows), ...queue.statements],
      expectedMutationChanges: [newRows.length, ...queue.expectedChanges],
      audits: newRows.map((row) => ({
        table_name: "slots",
        target_id: row.id,
        operation: "CREATE",
        after: snapshot(row),
        actor_user_id: guard.userId,
        retention_class: "normal",
        strict: true,
      })),
    });
  } catch (error) {
    return mutationError(error);
  }
  revalidateEventSlotPaths(data.event_id);
  return { ok: true, created: newRows.length };
}

export async function deleteAvailableSlots(
  formData: FormData,
): Promise<SlotActionResult> {
  const eventId = String(formData.get("event_id") ?? "").trim();
  if (!eventId) return { ok: false, message: "event_id が必要です。" };
  const guard = await ensureCanEditSlots(eventId, "manage_slot_delete");
  if (!guard.ok) return guard.result;
  const rows = await guard.db
    .select()
    .from(slots)
    .where(and(eq(slots.event_id, eventId), eq(slots.status, "available"))!)
    .limit(MAX_ATOMIC_SLOT_ROWS + 1);
  if (rows.length === 0) return { ok: true, created: 0 };
  if (rows.length > MAX_ATOMIC_SLOT_ROWS) {
    return {
      ok: false,
      message: `一度に処理できる枠は ${MAX_ATOMIC_SLOT_ROWS} 件までです。`,
    };
  }
  return deleteRows(guard.db, eventId, rows, guard.userId, "slot_admin_delete_available");
}

async function deleteRows(
  db: DB,
  eventId: string,
  rows: SlotRow[],
  userId: string,
  reason: string,
): Promise<SlotActionResult> {
  const queue = await eventQueue(db, eventId, reason, userId);
  try {
    await mutateWithAudit(db, {
      mutationStatements: [
        db.delete(slots).where(versionedWhere(eventId, rows, "available")),
        ...queue.statements,
      ],
      expectedMutationChanges: [rows.length, ...queue.expectedChanges],
      audits: rows.map((row) => ({
        table_name: "slots",
        target_id: row.id,
        operation: "DELETE",
        before: snapshot(row),
        actor_user_id: userId,
        retention_class: "normal",
        strict: true,
      })),
    });
  } catch (error) {
    return mutationError(error);
  }
  revalidateEventSlotPaths(eventId);
  return { ok: true, created: rows.length };
}

export async function releaseSlot(
  formData: FormData,
): Promise<SlotActionResult> {
  const slotId = String(formData.get("slot_id") ?? "").trim();
  if (!slotId) return { ok: false, message: "slot_id が必要です。" };
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
  const row = (
    await db.select().from(slots).where(eq(slots.id, slotId)).limit(1)
  )[0];
  if (!row) return { ok: false, message: "枠が見つかりません。" };
  const guard = await ensureCanEditSlots(row.event_id, "manage_slot_update");
  if (!guard.ok) return guard.result;
  if (row.status !== "reserved") {
    return { ok: false, message: "予約中の枠だけ解放できます。" };
  }
  return releaseRows(guard.db, row.event_id, [row], guard.userId);
}

async function releaseRows(
  db: DB,
  eventId: string,
  rows: SlotRow[],
  userId: string,
): Promise<SlotActionResult> {
  const now = Math.floor(Date.now() / 1000);
  const notifications: BatchItem<"sqlite">[] = [];
  for (const row of rows) {
    const notification = await releaseNotification(db, row);
    if (notification) notifications.push(notification);
  }
  const queue = await eventQueue(db, eventId, "slot_admin_release", userId);
  try {
    await mutateWithAudit(db, {
      mutationStatements: [
        db
          .update(slots)
          .set({
            status: "available",
            reserved_by_user_id: null,
            x_user_id: null,
            display_name: null,
            reservation_group_id: null,
            video_id: null,
            updated_at: now,
            version: sql`${slots.version} + 1`,
          })
          .where(versionedWhere(eventId, rows, "reserved")),
        ...queue.statements,
      ],
      expectedMutationChanges: [rows.length, ...queue.expectedChanges],
      audits: rows.map((row) => ({
        table_name: "slots",
        target_id: row.id,
        operation: "UPDATE",
        before: snapshot(row),
        after: {
          ...snapshot(row),
          status: "available",
          reserved_by_user_id: null,
          x_user_id: null,
          display_name: null,
          reservation_group_id: null,
          video_id: null,
          updated_at: now,
          version: row.version + 1,
        },
        actor_user_id: userId,
        retention_class: "long_audit",
        strict: true,
      })),
      postAuditStatements: notifications,
    });
  } catch (error) {
    return mutationError(error);
  }
  revalidateEventSlotPaths(eventId);
  return { ok: true, message: `${rows.length}件の予約枠を解放しました。` };
}

export async function deleteSlot(
  formData: FormData,
): Promise<SlotActionResult> {
  const slotId = String(formData.get("slot_id") ?? "").trim();
  if (!slotId) return { ok: false, message: "slot_id が必要です。" };
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
  const row = (
    await db.select().from(slots).where(eq(slots.id, slotId)).limit(1)
  )[0];
  if (!row) return { ok: false, message: "枠が見つかりません。" };
  if (row.status !== "available") {
    return { ok: false, message: "予約済み・投稿済みの枠は削除できません。" };
  }
  const guard = await ensureCanEditSlots(row.event_id, "manage_slot_delete");
  if (!guard.ok) return guard.result;
  return deleteRows(guard.db, row.event_id, [row], guard.userId, "slot_admin_delete");
}

export async function batchDeleteAvailableSlots(
  formData: FormData,
): Promise<SlotActionResult> {
  const eventId = String(formData.get("event_id") ?? "").trim();
  const slotIds = parseSlotIds(formData);
  if (!eventId || slotIds.length === 0 || slotIds.length > MAX_ATOMIC_SLOT_ROWS) {
    return { ok: false, message: "event_id と処理上限内の枠を指定してください。" };
  }
  const guard = await ensureCanEditSlots(eventId, "manage_slot_delete");
  if (!guard.ok) return guard.result;
  const rows = await guard.db
    .select()
    .from(slots)
    .where(and(eq(slots.event_id, eventId), inArray(slots.id, slotIds))!);
  if (rows.length !== slotIds.length || rows.some((row) => row.status !== "available")) {
    return { ok: false, message: "対象に空き枠以外または存在しない枠があります。" };
  }
  return deleteRows(guard.db, eventId, rows, guard.userId, "slot_admin_batch_delete");
}

export async function batchReleaseReservedSlots(
  formData: FormData,
): Promise<SlotActionResult> {
  const eventId = String(formData.get("event_id") ?? "").trim();
  const slotIds = parseSlotIds(formData);
  if (!eventId || slotIds.length === 0 || slotIds.length > MAX_ATOMIC_SLOT_ROWS) {
    return { ok: false, message: "event_id と処理上限内の枠を指定してください。" };
  }
  const guard = await ensureCanEditSlots(eventId, "manage_slot_update");
  if (!guard.ok) return guard.result;
  const rows = await guard.db
    .select()
    .from(slots)
    .where(and(eq(slots.event_id, eventId), inArray(slots.id, slotIds))!);
  if (rows.length !== slotIds.length || rows.some((row) => row.status !== "reserved")) {
    return { ok: false, message: "対象に予約中以外または存在しない枠があります。" };
  }
  return releaseRows(guard.db, eventId, rows, guard.userId);
}

export async function batchUpdateSlotLabels(
  formData: FormData,
): Promise<SlotActionResult> {
  const eventId = String(formData.get("event_id") ?? "").trim();
  const slotIds = parseSlotIds(formData);
  const label = String(formData.get("label") ?? "").trim();
  if (
    !eventId ||
    !label ||
    label.length > 200 ||
    slotIds.length === 0 ||
    slotIds.length > MAX_ATOMIC_SLOT_ROWS
  ) {
    return { ok: false, message: "event_id・枠・上限内のラベルを指定してください。" };
  }
  const guard = await ensureCanEditSlots(eventId, "manage_slot_update");
  if (!guard.ok) return guard.result;
  const rows = await guard.db
    .select()
    .from(slots)
    .where(and(eq(slots.event_id, eventId), inArray(slots.id, slotIds))!);
  if (rows.length !== slotIds.length) {
    return { ok: false, message: "存在しない枠が含まれています。" };
  }
  const now = Math.floor(Date.now() / 1000);
  const queue = await eventQueue(guard.db, eventId, "slot_admin_label_update", guard.userId);
  try {
    await mutateWithAudit(guard.db, {
      mutationStatements: [
        guard.db
          .update(slots)
          .set({
            slot_label: label,
            updated_at: now,
            version: sql`${slots.version} + 1`,
          })
          .where(versionedWhere(eventId, rows)),
        ...queue.statements,
      ],
      expectedMutationChanges: [rows.length, ...queue.expectedChanges],
      audits: rows.map((row) => ({
        table_name: "slots",
        target_id: row.id,
        operation: "UPDATE",
        before: snapshot(row),
        after: {
          ...snapshot(row),
          slot_label: label,
          updated_at: now,
          version: row.version + 1,
        },
        actor_user_id: guard.userId,
        retention_class: "normal",
        strict: true,
      })),
    });
  } catch (error) {
    return mutationError(error);
  }
  revalidateEventSlotPaths(eventId);
  return { ok: true, message: `${rows.length}件のラベルを更新しました。` };
}
