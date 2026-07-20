"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  and,
  asc,
  desc,
  eq,
  sql,
  type SQL,
} from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { mutateWithAudit } from "@/lib/audit/mutate";
import {
  writeGuard,
  type WriteGuardDenyReason,
} from "@/lib/auth/writeGuard";
import { isAuthUserLinkedToXUser } from "@/lib/auth/xIdentity";
import { getDatabase } from "@/lib/cloudflare";
import { events, slots, xUsers } from "@/lib/db/schema";
import { MAX_ATOMIC_SLOT_ROWS } from "@/lib/slots/atomicLimits";
import { buildReleaseGroupDecisions } from "@/lib/slots/userSlotCore";
import { buildStaticRebuildQueueBatch } from "@/lib/staticRebuild/enqueue";
import { isAcceptingEntries } from "@/lib/utils/eventStatus";
import { generateId } from "@/lib/utils/id";
import {
  areSlotsInSamePart,
  sortSlotsChronologically,
} from "@/lib/utils/slotGroupingCore";

export interface SlotReserveResult {
  ok: boolean;
  message?: string;
  slotId?: string;
  reason?: WriteGuardDenyReason;
}

type DB = NonNullable<ReturnType<typeof getDatabase>>;
type SlotRow = typeof slots.$inferSelect;
type EventRow = typeof events.$inferSelect;
type SlotPatch = Partial<typeof slots.$inferInsert>;

type PlannedSlotUpdate = {
  before: SlotRow;
  after: SlotRow;
  statement: BatchItem<"sqlite">;
};

const reserveSchema = z.object({
  slot_id: z.string().trim().min(1),
  display_name: z.string().trim().min(1).max(80),
  consecutive_count: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_ATOMIC_SLOT_ROWS)
    .default(1),
});

const extendSchema = z.object({
  slot_id: z.string().trim().min(1),
  direction: z.enum(["forward", "backward"]),
});

const mergeSchema = z.object({
  gap_slot_id: z.string().trim().min(1),
  display_name: z.string().trim().min(1).max(80),
});

function snapshot(row: SlotRow): Record<string, unknown> {
  return { ...row };
}

function mutationError(error: unknown): SlotReserveResult {
  console.warn(
    "[user-slot] atomic mutation failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return {
    ok: false,
    message:
      "枠の状態が変更されたか、安全な保存を完了できませんでした。画面を更新してもう一度お試しください。",
  };
}

function revalidateSlotViews(eventId: string): void {
  revalidatePath(`/event/${eventId}`);
  revalidatePath(`/event/${eventId}/slots`);
  revalidatePath(`/manage/events/${eventId}/slots`);
  revalidatePath(`/manage/events/${eventId}`);
  revalidatePath("/manage");
  revalidatePath(`/admin/events/${eventId}/slots`);
  revalidatePath("/dashboard");
}

function slotPartGapSec(event: EventRow): number {
  const minutes = event.slot_part_gap_minutes ?? 15;
  return Number.isFinite(minutes) && minutes >= 0 ? minutes * 60 : 15 * 60;
}

function eventAtomicLimit(event: EventRow): number {
  const configured = Number(event.max_consecutive_slots_per_entry ?? 1);
  if (!Number.isFinite(configured) || configured < 1) return 1;
  return Math.min(Math.floor(configured), MAX_ATOMIC_SLOT_ROWS);
}

function reservationGroupScope(groupId: string, eventId: string) {
  return and(
    eq(slots.event_id, eventId),
    eq(slots.reservation_group_id, groupId),
  )!;
}

/** 全列を比較し、読取後の変更を version 以外の列でも検出する。 */
function expectedRowCondition(row: SlotRow) {
  return and(
    eq(slots.id, row.id),
    eq(slots.event_id, row.event_id),
    eq(slots.status, row.status),
    eq(slots.version, row.version),
    eq(slots.updated_at, row.updated_at),
    sql`${slots.reserved_by_user_id} IS ${row.reserved_by_user_id}`,
    sql`${slots.x_user_id} IS ${row.x_user_id}`,
    sql`${slots.display_name} IS ${row.display_name}`,
    sql`${slots.slot_kind} IS ${row.slot_kind}`,
    sql`${slots.slot_label} IS ${row.slot_label}`,
    sql`${slots.start_time} IS ${row.start_time}`,
    sql`${slots.sort_order} IS ${row.sort_order}`,
    sql`${slots.reservation_group_id} IS ${row.reservation_group_id}`,
    sql`${slots.priority_reclaim_video_id} IS ${row.priority_reclaim_video_id}`,
    sql`${slots.priority_reclaim_until} IS ${row.priority_reclaim_until}`,
    sql`${slots.video_id} IS ${row.video_id}`,
  )!;
}

function planSlotUpdate(
  db: DB,
  before: SlotRow,
  patch: SlotPatch,
  now: number,
): PlannedSlotUpdate {
  const values: SlotPatch = {
    ...patch,
    updated_at: now,
    version: before.version + 1,
  };
  return {
    before,
    after: { ...before, ...values } as SlotRow,
    statement: db.update(slots).set(values).where(expectedRowCondition(before)),
  };
}

async function commitSlotUpdates(args: {
  db: DB;
  updates: readonly PlannedSlotUpdate[];
  eventId: string;
  actorUserId: string;
  reason: string;
}): Promise<void> {
  if (
    args.updates.length === 0 ||
    args.updates.length > MAX_ATOMIC_SLOT_ROWS ||
    new Set(args.updates.map((update) => update.before.id)).size !==
      args.updates.length
  ) {
    throw new Error("原子的に処理できる枠数を超えています。");
  }

  const queue = await buildStaticRebuildQueueBatch(args.db, [
    {
      targetType: "event",
      targetId: args.eventId,
      reason: args.reason,
      priority: "high",
      requestedByUserId: args.actorUserId,
    },
  ]);

  await mutateWithAudit(args.db, {
    mutationStatements: [
      ...args.updates.map((update) => update.statement),
      ...queue.statements,
    ],
    expectedMutationChanges: [
      ...args.updates.map(() => 1),
      ...queue.expectedChanges,
    ],
    audits: args.updates.map((update) => ({
      table_name: "slots",
      target_id: update.before.id,
      operation: "UPDATE",
      before: snapshot(update.before),
      after: snapshot(update.after),
      actor_user_id: args.actorUserId,
      reason: args.reason,
      context: "user-slot",
      retention_class: "normal",
      restore_strategy: "update_before",
      strict: true,
    })),
  });
}

async function loadSlot(db: DB, slotId: string): Promise<SlotRow | null> {
  return (
    await db.select().from(slots).where(eq(slots.id, slotId)).limit(1)
  )[0] ?? null;
}

async function loadEvent(db: DB, eventId: string): Promise<EventRow | null> {
  return (
    await db.select().from(events).where(eq(events.id, eventId)).limit(1)
  )[0] ?? null;
}

async function loadBoundedGroup(db: DB, anchor: SlotRow): Promise<SlotRow[]> {
  const groupId = anchor.reservation_group_id?.trim() || null;
  if (!groupId) return [anchor];

  const rows = await db
    .select()
    .from(slots)
    .where(reservationGroupScope(groupId, anchor.event_id))
    .limit(MAX_ATOMIC_SLOT_ROWS + 1);
  if (rows.length > MAX_ATOMIC_SLOT_ROWS) {
    throw new Error(
      `連続枠が上限 ${MAX_ATOMIC_SLOT_ROWS} 件を超えています。運営へ連絡してください。`,
    );
  }
  if (rows.length === 0 || !rows.some((row) => row.id === anchor.id)) {
    throw new Error("連続枠の完全な状態を確認できませんでした。");
  }
  if (
    rows.some(
      (row) =>
        row.event_id !== anchor.event_id ||
        row.reserved_by_user_id !== anchor.reserved_by_user_id ||
        row.x_user_id !== anchor.x_user_id,
    )
  ) {
    throw new Error("連続枠に別の利用者または X ID が混在しています。");
  }
  return sortSlotsChronologically(rows);
}

function orderCondition(row: SlotRow, direction: "forward" | "backward"): SQL {
  const sortOrder = row.sort_order ?? 0;
  if (row.start_time != null) {
    return direction === "forward"
      ? sql`
          ${slots.start_time} IS NOT NULL AND (
            ${slots.start_time} > ${row.start_time}
            OR (
              ${slots.start_time} = ${row.start_time}
              AND (
                COALESCE(${slots.sort_order}, 0) > ${sortOrder}
                OR (
                  COALESCE(${slots.sort_order}, 0) = ${sortOrder}
                  AND ${slots.id} > ${row.id}
                )
              )
            )
          )
        `
      : sql`
          ${slots.start_time} IS NOT NULL AND (
            ${slots.start_time} < ${row.start_time}
            OR (
              ${slots.start_time} = ${row.start_time}
              AND (
                COALESCE(${slots.sort_order}, 0) < ${sortOrder}
                OR (
                  COALESCE(${slots.sort_order}, 0) = ${sortOrder}
                  AND ${slots.id} < ${row.id}
                )
              )
            )
          )
        `;
  }
  return direction === "forward"
    ? sql`
        ${slots.start_time} IS NULL AND (
          COALESCE(${slots.sort_order}, 0) > ${sortOrder}
          OR (
            COALESCE(${slots.sort_order}, 0) = ${sortOrder}
            AND ${slots.id} > ${row.id}
          )
        )
      `
    : sql`
        ${slots.start_time} IS NULL AND (
          COALESCE(${slots.sort_order}, 0) < ${sortOrder}
          OR (
            COALESCE(${slots.sort_order}, 0) = ${sortOrder}
            AND ${slots.id} < ${row.id}
          )
        )
      `;
}

async function loadOrderedNeighbors(
  db: DB,
  row: SlotRow,
  direction: "forward" | "backward",
): Promise<SlotRow[]> {
  const query = db
    .select()
    .from(slots)
    .where(and(eq(slots.event_id, row.event_id), orderCondition(row, direction))!);
  if (row.start_time != null) {
    return direction === "forward"
      ? query
        .orderBy(
          asc(slots.start_time),
          asc(sql`COALESCE(${slots.sort_order}, 0)`),
          asc(slots.id),
        )
        .limit(MAX_ATOMIC_SLOT_ROWS + 1)
      : query
        .orderBy(
          desc(slots.start_time),
          desc(sql`COALESCE(${slots.sort_order}, 0)`),
          desc(slots.id),
        )
        .limit(MAX_ATOMIC_SLOT_ROWS + 1);
  }
  return direction === "forward"
    ? query
        .orderBy(
          asc(sql`COALESCE(${slots.sort_order}, 0)`),
          asc(slots.id),
        )
        .limit(MAX_ATOMIC_SLOT_ROWS + 1)
    : query
        .orderBy(
          desc(sql`COALESCE(${slots.sort_order}, 0)`),
          desc(slots.id),
        )
        .limit(MAX_ATOMIC_SLOT_ROWS + 1);
}

function assertAdjacentSequence(rows: readonly SlotRow[], gapSec: number): void {
  for (let index = 1; index < rows.length; index += 1) {
    if (!areSlotsInSamePart(rows[index - 1], rows[index], gapSec)) {
      throw new Error("別の部または連続していない枠はまとめて操作できません。");
    }
  }
}

async function ownsSlot(
  db: DB,
  row: SlotRow,
  userId: string,
  activeXId: string | null,
): Promise<boolean> {
  if (row.x_user_id) {
    if (row.x_user_id === activeXId) return true;
    return isAuthUserLinkedToXUser(db, userId, row.x_user_id);
  }
  return row.reserved_by_user_id === userId;
}

export async function reserveSlot(
  formData: FormData,
): Promise<SlotReserveResult> {
  const guard = await writeGuard({
    requireActiveXId: true,
    requireApprovedActiveXId: false,
    feature: "reserve_slot",
  });
  if (!guard.ok) {
    return { ok: false, reason: guard.reason, message: guard.message };
  }
  if (!guard.activeXId) {
    return { ok: false, message: "X ID を選択してから枠を確保してください。" };
  }
  const parsed = reserveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "入力エラー",
    };
  }
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  try {
    const anchor = await loadSlot(db, parsed.data.slot_id);
    if (!anchor) return { ok: false, message: "枠が見つかりません。" };
    if (anchor.status !== "available") {
      return { ok: false, message: "この枠はすでに確保されています。" };
    }
    const event = await loadEvent(db, anchor.event_id);
    if (!event) return { ok: false, message: "イベントが見つかりません。" };
    if (!isAcceptingEntries(event)) {
      return { ok: false, message: "受付中ではないため枠を確保できません。" };
    }
    const maxRows = eventAtomicLimit(event);
    if (parsed.data.consecutive_count > maxRows) {
      return {
        ok: false,
        message: `一度に確保できる連続枠は ${maxRows} 件までです。`,
      };
    }

    const targetRows = [anchor];
    if (parsed.data.consecutive_count > 1) {
      const candidates = await loadOrderedNeighbors(db, anchor, "forward");
      targetRows.push(
        ...candidates.slice(0, parsed.data.consecutive_count - 1),
      );
    }
    if (targetRows.length !== parsed.data.consecutive_count) {
      return { ok: false, message: "必要な数の連続空き枠がありません。" };
    }
    if (targetRows.some((row) => row.status !== "available")) {
      return { ok: false, message: "連続枠の途中に確保済みの枠があります。" };
    }
    assertAdjacentSequence(targetRows, slotPartGapSec(event));

    const now = Math.floor(Date.now() / 1000);
    const groupId = targetRows.length > 1 ? generateId("sgrp") : null;
    const updates = targetRows.map((row) =>
      planSlotUpdate(
        db,
        row,
        {
          reserved_by_user_id: guard.user.id,
          x_user_id: guard.activeXId,
          display_name: parsed.data.display_name,
          reservation_group_id: groupId,
          status: "reserved",
        },
        now,
      ),
    );
    await commitSlotUpdates({
      db,
      updates,
      eventId: anchor.event_id,
      actorUserId: guard.user.id,
      reason: "slot_user_reserve",
    });
    revalidateSlotViews(anchor.event_id);
    return { ok: true, slotId: anchor.id };
  } catch (error) {
    return mutationError(error);
  }
}

export async function releaseOwnSlot(
  formData: FormData,
): Promise<SlotReserveResult> {
  const guard = await writeGuard({ feature: "release_slot" });
  if (!guard.ok) {
    return { ok: false, reason: guard.reason, message: guard.message };
  }
  const slotId = String(formData.get("slot_id") ?? "").trim();
  if (!slotId) return { ok: false, message: "slot_id が必要です。" };
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  try {
    const anchor = await loadSlot(db, slotId);
    if (!anchor) return { ok: false, message: "枠が見つかりません。" };
    if (!(await ownsSlot(db, anchor, guard.user.id, guard.activeXId))) {
      return { ok: false, message: "自分が確保した枠のみ解放できます。" };
    }
    if (anchor.status !== "reserved") {
      return {
        ok: false,
        message: "提出済みの枠は解放できません。先に作品取り下げを相談してください。",
      };
    }

    const groupRows = await loadBoundedGroup(db, anchor);
    if (groupRows.some((row) => row.status !== "reserved")) {
      return { ok: false, message: "予約中でない枠を含む連続枠は解放できません。" };
    }
    const now = Math.floor(Date.now() / 1000);
    const decisions = new Map(
      buildReleaseGroupDecisions(groupRows, anchor.id).map((decision) => [
        decision.id,
        decision,
      ]),
    );
    const updates = groupRows.map((row) => {
      const decision = decisions.get(row.id);
      if (!decision) throw new Error("連続枠の状態を確定できませんでした。");
      if (decision.release) {
        return planSlotUpdate(
          db,
          row,
          {
            reserved_by_user_id: null,
            x_user_id: null,
            display_name: null,
            reservation_group_id: null,
            status: "available",
          },
          now,
        );
      }
      return planSlotUpdate(
        db,
        row,
        {
          reservation_group_id: decision.reservation_group_id,
        },
        now,
      );
    });
    await commitSlotUpdates({
      db,
      updates,
      eventId: anchor.event_id,
      actorUserId: guard.user.id,
      reason: "slot_user_release",
    });
    revalidateSlotViews(anchor.event_id);
    return { ok: true, slotId: anchor.id };
  } catch (error) {
    return mutationError(error);
  }
}

/** 自分のグループに前方または後方の隣接空き枠を一つ追加する。 */
export async function extendOwnSlotGroup(
  formData: FormData,
): Promise<SlotReserveResult> {
  const guard = await writeGuard({
    requireActiveXId: true,
    requireApprovedActiveXId: false,
    feature: "extend_slot_group",
  });
  if (!guard.ok) {
    return { ok: false, reason: guard.reason, message: guard.message };
  }
  if (!guard.activeXId) {
    return { ok: false, message: "X ID を選択してから操作してください。" };
  }
  const parsed = extendSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "入力エラー",
    };
  }
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  try {
    const anchor = await loadSlot(db, parsed.data.slot_id);
    if (!anchor) return { ok: false, message: "枠が見つかりません。" };
    if (
      anchor.status !== "reserved" ||
      anchor.x_user_id !== guard.activeXId ||
      anchor.reserved_by_user_id !== guard.user.id
    ) {
      return { ok: false, message: "自分の予約中の枠のみ拡張できます。" };
    }
    const event = await loadEvent(db, anchor.event_id);
    if (!event) return { ok: false, message: "イベントが見つかりません。" };
    if (!isAcceptingEntries(event)) {
      return { ok: false, message: "受付中ではないため枠を拡張できません。" };
    }
    const groupRows = await loadBoundedGroup(db, anchor);
    if (groupRows.length + 1 > eventAtomicLimit(event)) {
      return { ok: false, message: "連続枠の上限を超えるため拡張できません。" };
    }
    if (groupRows.some((row) => row.status !== "reserved")) {
      return { ok: false, message: "予約中でない枠を含む連続枠は拡張できません。" };
    }

    const edge = parsed.data.direction === "backward"
      ? groupRows[0]
      : groupRows[groupRows.length - 1];
    const candidate = (
      await loadOrderedNeighbors(db, edge, parsed.data.direction)
    )[0];
    if (!candidate || candidate.status !== "available") {
      return { ok: false, message: "拡張可能な隣接空き枠がありません。" };
    }
    const orderedPair = parsed.data.direction === "backward"
      ? [candidate, edge]
      : [edge, candidate];
    assertAdjacentSequence(orderedPair, slotPartGapSec(event));
    if (candidate.slot_kind !== anchor.slot_kind) {
      return { ok: false, message: "種類が異なる枠は拡張できません。" };
    }

    const now = Math.floor(Date.now() / 1000);
    const groupId = anchor.reservation_group_id || generateId("sgrp");
    const updates = [
      ...groupRows.map((row) =>
        planSlotUpdate(db, row, { reservation_group_id: groupId }, now),
      ),
      planSlotUpdate(
        db,
        candidate,
        {
          reserved_by_user_id: guard.user.id,
          x_user_id: guard.activeXId,
          display_name: groupRows[0].display_name,
          reservation_group_id: groupId,
          status: "reserved",
        },
        now,
      ),
    ];
    await commitSlotUpdates({
      db,
      updates,
      eventId: anchor.event_id,
      actorUserId: guard.user.id,
      reason: "slot_user_extend",
    });
    revalidateSlotViews(anchor.event_id);
    return { ok: true, slotId: candidate.id };
  } catch (error) {
    return mutationError(error);
  }
}

/** 左右の同一主体グループ間にある一枠を埋め、最大三枠へ結合する。 */
export async function mergeOwnSlotGroups(
  formData: FormData,
): Promise<SlotReserveResult> {
  const guard = await writeGuard({
    requireActiveXId: true,
    requireApprovedActiveXId: false,
    feature: "merge_slot_groups",
  });
  if (!guard.ok) {
    return { ok: false, reason: guard.reason, message: guard.message };
  }
  if (!guard.activeXId) {
    return { ok: false, message: "X ID を選択してから操作してください。" };
  }
  const parsed = mergeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "入力エラー",
    };
  }
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  try {
    const gap = await loadSlot(db, parsed.data.gap_slot_id);
    if (!gap) return { ok: false, message: "枠が見つかりません。" };
    if (gap.status !== "available") {
      return { ok: false, message: "対象の枠はすでに確保されています。" };
    }
    const event = await loadEvent(db, gap.event_id);
    if (!event) return { ok: false, message: "イベントが見つかりません。" };
    if (!isAcceptingEntries(event)) {
      return { ok: false, message: "受付中ではないため結合できません。" };
    }

    const left = (await loadOrderedNeighbors(db, gap, "backward"))[0];
    const right = (await loadOrderedNeighbors(db, gap, "forward"))[0];
    if (!left || !right) {
      return { ok: false, message: "結合対象の隣接枠がありません。" };
    }
    assertAdjacentSequence([left, gap, right], slotPartGapSec(event));
    if (
      left.slot_kind !== gap.slot_kind ||
      right.slot_kind !== gap.slot_kind ||
      left.status !== "reserved" ||
      right.status !== "reserved" ||
      left.x_user_id !== guard.activeXId ||
      right.x_user_id !== guard.activeXId ||
      left.reserved_by_user_id !== guard.user.id ||
      right.reserved_by_user_id !== guard.user.id
    ) {
      return { ok: false, message: "自分の予約中の隣接枠どうしのみ結合できます。" };
    }

    const leftGroup = await loadBoundedGroup(db, left);
    const rightGroup = await loadBoundedGroup(db, right);
    const byId = new Map<string, SlotRow>();
    for (const row of [...leftGroup, ...rightGroup]) byId.set(row.id, row);
    const reservedRows = sortSlotsChronologically([...byId.values()]);
    if (
      reservedRows.some(
        (row) =>
          row.status !== "reserved" ||
          row.x_user_id !== guard.activeXId ||
          row.reserved_by_user_id !== guard.user.id,
      )
    ) {
      return { ok: false, message: "連続枠に別の利用者または状態が混在しています。" };
    }
    if (reservedRows.length + 1 > eventAtomicLimit(event)) {
      return { ok: false, message: "連続枠の上限を超えるため結合できません。" };
    }
    assertAdjacentSequence(
      sortSlotsChronologically([...reservedRows, gap]),
      slotPartGapSec(event),
    );

    const now = Math.floor(Date.now() / 1000);
    const groupId = generateId("sgrp");
    const updates = [
      ...reservedRows.map((row) =>
        planSlotUpdate(
          db,
          row,
          {
            display_name: parsed.data.display_name,
            reservation_group_id: groupId,
          },
          now,
        ),
      ),
      planSlotUpdate(
        db,
        gap,
        {
          reserved_by_user_id: guard.user.id,
          x_user_id: guard.activeXId,
          display_name: parsed.data.display_name,
          reservation_group_id: groupId,
          status: "reserved",
        },
        now,
      ),
    ];
    await commitSlotUpdates({
      db,
      updates,
      eventId: gap.event_id,
      actorUserId: guard.user.id,
      reason: "slot_user_merge",
    });
    revalidateSlotViews(gap.event_id);
    return { ok: true, slotId: gap.id };
  } catch (error) {
    return mutationError(error);
  }
}
