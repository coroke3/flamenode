"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDatabase } from "@/lib/cloudflare";
import { assertCanEditEvent } from "@/lib/auth/ownership";
import { writeGuard } from "@/lib/auth/writeGuard";
import { slots } from "@/lib/db/schema";
import { mutateWithAudit } from "@/lib/audit/mutate";
import { runPostCommitBestEffort } from "@/lib/audit/postCommit";
import { parseJstDatetimeLocal } from "@/lib/utils/dateInput";
import { generateId } from "@/lib/utils/id";
import { createTraceId } from "@/lib/observability/flowTrace";
import { buildSlotForceReleasedNotification } from "@/lib/notifications/templates/slot";
import {
  buildNotificationOutboxStatement,
  type NotificationOutboxStatement,
} from "@/lib/notifications/enqueue";
import { enqueueStaticRebuildMany } from "@/lib/staticRebuild/enqueue";
import { buildSlotChangeQueueBatch, topGlobalTarget } from "@/lib/staticRebuild/hooks";
import {
  markPendingPublicReflection,
  type PendingPublicReflection,
} from "@/lib/staticRebuild/publicReflectionNotice";
import { MAX_ATOMIC_SLOT_ROWS, MAX_SLOT_BATCH_GENERATE_COUNT } from "@/lib/slots/atomicLimits";
import { MAX_SLOTS_PER_VIDEO } from "@/lib/slots/limits";
import { versionedSlotWhere } from "@/lib/slots/versionedPredicate";

export interface SlotActionResult extends PendingPublicReflection {
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
  count: z.coerce.number().min(1).max(MAX_SLOT_BATCH_GENERATE_COUNT).default(1),
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

async function revalidateEventSlotPathsBestEffort(eventId: string): Promise<void> {
  await runPostCommitBestEffort(
    { flow: "slot_admin", traceId: createTraceId() },
    [
      {
        name: "revalidate_event_slot_paths",
        run: async () => {
          revalidateEventSlotPaths(eventId);
        },
      },
    ],
  );
}

function snapshot(row: SlotRow): Record<string, unknown> {
  return { ...row };
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
    unstable_rethrow(error);
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
  unstable_rethrow(error);
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
  return buildSlotChangeQueueBatch(db, {
    eventId,
    reason,
    requestedByUserId: userId,
  });
}

async function releaseNotification(
  db: DB,
  row: SlotRow,
  targetIds: readonly string[],
  groupId: string | null,
): Promise<NotificationOutboxStatement | null> {
  if (!row.reserved_by_user_id) return null;
  return buildNotificationOutboxStatement(db, {
    recipientUserId: row.reserved_by_user_id,
    type: "slot_force_released",
    dedupeKey: `slot_force_released:${row.event_id}:${row.id}:${groupId ?? "solo"}:${row.version}`,
    payload: buildSlotForceReleasedNotification({
      eventId: row.event_id,
      slotIds: [...targetIds],
      reservationGroupId: groupId,
    }),
    eventId: row.event_id,
  });
}

function chunkRows<T>(rows: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let offset = 0; offset < rows.length; offset += size) {
    chunks.push(rows.slice(offset, offset + size));
  }
  return chunks;
}

async function insertGeneratedSlotRows(
  db: DB,
  eventId: string,
  mode: "time" | "count",
  rows: readonly SlotRow[],
  userId: string,
  options: { includeQueue: boolean },
): Promise<void> {
  if (rows.length === 0) return;

  const slotColumns = sql.raw(
    "id, event_id, reserved_by_user_id, x_user_id, display_name, slot_label, start_time, sort_order, reservation_group_id, video_id, status, updated_at, version",
  );
  const insertCandidates = sql.join(
    rows.map(
      (row) => sql`
        SELECT ${row.id}, ${row.event_id}, ${row.reserved_by_user_id}, ${row.x_user_id},
               ${row.display_name}, ${row.slot_label}, ${row.start_time}, ${row.sort_order},
               ${row.reservation_group_id}, ${row.video_id}, ${row.status},
               ${row.updated_at}, ${row.version}
        WHERE NOT EXISTS (
          SELECT 1 FROM slots
          WHERE event_id = ${row.event_id}
            AND ${
              mode === "time"
                ? sql`start_time = ${row.start_time}`
                : sql`sort_order = ${row.sort_order}`
            }
        )
      `,
    ),
    sql` UNION ALL `,
  );
  const insert = db.run(
    sql`INSERT INTO slots (${slotColumns}) ${insertCandidates}`,
  );
  const queue = options.includeQueue
    ? await eventQueue(db, eventId, "slot_admin_generate", userId)
    : { statements: [] as BatchItem<"sqlite">[], expectedChanges: [] as number[] };

  await mutateWithAudit(db, {
    mutationStatements: [insert, ...queue.statements],
    expectedMutationChanges: [rows.length, ...queue.expectedChanges],
    audits: rows.map((row) => ({
      table_name: "slots",
      target_id: row.id,
      operation: "CREATE",
      after: snapshot(row),
      actor_user_id: userId,
      retention_class: "normal",
      strict: true,
    })),
    staticRebuildWakeSource: queue.statements.length > 0 ? "manage" : undefined,
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
  if (newRows.length > MAX_SLOT_BATCH_GENERATE_COUNT) {
    return {
      ok: false,
      message: `一度に作成できる枠は ${MAX_SLOT_BATCH_GENERATE_COUNT} 件までです。`,
    };
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

  const chunks = chunkRows(newRows, MAX_ATOMIC_SLOT_ROWS);
  let created = 0;
  try {
    for (const [index, chunk] of chunks.entries()) {
      await insertGeneratedSlotRows(
        guard.db,
        data.event_id,
        data.mode,
        chunk,
        guard.userId,
        { includeQueue: true },
      );
      created += chunk.length;
    }
  } catch (error) {
    if (created > 0) {
      await enqueueStaticRebuildMany(guard.db, [
        {
          targetType: "event",
          targetId: data.event_id,
          reason: "slot_admin_generate_partial",
          priority: "high",
          requestedByUserId: guard.userId,
        },
        topGlobalTarget("slot_admin_generate_partial", "high"),
      ]);
      await revalidateEventSlotPathsBestEffort(data.event_id);
      return {
        ok: false,
        message: `枠の作成中に失敗しました（${created}/${newRows.length} 件まで作成済み）。残りは再実行してください。`,
      };
    }
    return mutationError(error);
  }
  await revalidateEventSlotPathsBestEffort(data.event_id);
  return markPendingPublicReflection({ ok: true, created: newRows.length }, true);
}

export async function deleteAvailableSlots(
  formData: FormData,
): Promise<SlotActionResult> {
  const eventId = String(formData.get("event_id") ?? "").trim();
  if (!eventId) return { ok: false, message: "event_id が必要です。" };
  const guard = await ensureCanEditSlots(eventId, "manage_slot_delete");
  if (!guard.ok) return guard.result;

  let totalDeleted = 0;
  while (true) {
    const rows = await guard.db
      .select()
      .from(slots)
      .where(and(eq(slots.event_id, eventId), eq(slots.status, "available"))!)
      .limit(MAX_ATOMIC_SLOT_ROWS);
    if (rows.length === 0) break;

    const result = await deleteRows(
      guard.db,
      eventId,
      rows,
      guard.userId,
      "slot_admin_delete_available",
    );
    if (!result.ok) return result;
    totalDeleted += rows.length;
  }

  return markPendingPublicReflection({ ok: true, created: totalDeleted }, totalDeleted > 0);
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
        db.delete(slots).where(versionedSlotWhere(eventId, rows, "available")),
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
      staticRebuildWakeSource: queue.statements.length > 0 ? "manage" : undefined,
    });
  } catch (error) {
    return mutationError(error);
  }
  await revalidateEventSlotPathsBestEffort(eventId);
  return markPendingPublicReflection(
    { ok: true, created: rows.length, message: `${rows.length}件の枠を削除しました。` },
    queue.statements.length > 0,
  );
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
  const groupId = row.reservation_group_id?.trim() || null;
  const rows = groupId
    ? await guard.db
        .select()
        .from(slots)
        .where(
          and(
            eq(slots.event_id, row.event_id),
            eq(slots.reservation_group_id, groupId),
          )!,
        )
        .limit(MAX_SLOTS_PER_VIDEO + 1)
    : [row];
  if (rows.length === 0 || rows.length > MAX_SLOTS_PER_VIDEO) {
    return {
      ok: false,
      message: `一度に解放できる枠は ${MAX_SLOTS_PER_VIDEO} 件までです。`,
    };
  }
  if (
    rows.some(
      (candidate) =>
        candidate.status !== "reserved" ||
        candidate.reserved_by_user_id !== row.reserved_by_user_id ||
        candidate.x_user_id !== row.x_user_id,
    )
  ) {
    return { ok: false, message: "対象グループ全体が同一利用者の予約中ではありません。" };
  }
  return releaseRows(guard.db, row.event_id, rows, guard.userId);
}

async function releaseRows(
  db: DB,
  eventId: string,
  rows: SlotRow[],
  userId: string,
): Promise<SlotActionResult> {
  const now = Math.floor(Date.now() / 1000);
  const notifications: BatchItem<"sqlite">[] = [];
  const grouped = new Map<string, SlotRow[]>();
  for (const row of rows) {
    const key = row.reservation_group_id?.trim() || `solo:${row.id}`;
    const current = grouped.get(key) ?? [];
    current.push(row);
    grouped.set(key, current);
  }
  for (const groupRows of grouped.values()) {
    const representative = groupRows[0];
    if (!representative) continue;
    const groupId = representative.reservation_group_id?.trim() || null;
    const notification = await releaseNotification(
      db,
      representative,
      groupRows.map((candidate) => candidate.id),
      groupId,
    );
    if (notification) notifications.push(notification.statement);
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
          .where(versionedSlotWhere(eventId, rows, "reserved")),
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
      notificationWakeSource: notifications.length > 0 ? "manage" : undefined,
      staticRebuildWakeSource: queue.statements.length > 0 ? "manage" : undefined,
    });
  } catch (error) {
    return mutationError(error);
  }
  await revalidateEventSlotPathsBestEffort(eventId);
  return markPendingPublicReflection(
    { ok: true, message: `${rows.length}件の予約枠を解放しました。` },
    queue.statements.length > 0,
  );
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
  const groupIds = Array.from(
    new Set(
      rows
        .map((row) => row.reservation_group_id?.trim() || null)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const groupRows = groupIds.length
    ? await guard.db
        .select()
        .from(slots)
        .where(
          and(
            eq(slots.event_id, eventId),
            inArray(slots.reservation_group_id, groupIds),
          )!,
        )
        .limit(MAX_ATOMIC_SLOT_ROWS + 1)
    : [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const row of groupRows) byId.set(row.id, row);
  const releaseTargets = [...byId.values()];
  if (releaseTargets.length > MAX_ATOMIC_SLOT_ROWS) {
    return {
      ok: false,
      message: `一括解放で reservation_group を含む処理対象は ${MAX_ATOMIC_SLOT_ROWS} 件以内です。大きな連続枠は枠ごとの強制解放を使ってください。`,
    };
  }
  if (releaseTargets.some((row) => row.status !== "reserved")) {
    return { ok: false, message: "reservation_group 全体が予約中ではありません。" };
  }
  for (const groupId of groupIds) {
    const members = releaseTargets.filter(
      (row) => row.reservation_group_id === groupId,
    );
    const representative = members[0];
    if (
      representative &&
      members.some(
        (row) =>
          row.reserved_by_user_id !== representative.reserved_by_user_id ||
          row.x_user_id !== representative.x_user_id,
      )
    ) {
      return { ok: false, message: "reservation_group に複数の利用者が混在しています。" };
    }
  }
  return releaseRows(guard.db, eventId, releaseTargets, guard.userId);
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
          .where(versionedSlotWhere(eventId, rows)),
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
      staticRebuildWakeSource: queue.statements.length > 0 ? "manage" : undefined,
    });
  } catch (error) {
    return mutationError(error);
  }
  await revalidateEventSlotPathsBestEffort(eventId);
  return markPendingPublicReflection(
    { ok: true, message: `${rows.length}件のラベルを更新しました。` },
    queue.statements.length > 0,
  );
}
