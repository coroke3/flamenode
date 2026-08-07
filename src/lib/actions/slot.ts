"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { mutateWithAudit } from "@/lib/audit/mutate";
import { runPostCommitBestEffort } from "@/lib/audit/postCommit";
import {
  writeGuard,
  type WriteGuardDenyReason,
} from "@/lib/auth/writeGuard";
import { getDatabase } from "@/lib/cloudflare";
import { events, slots, users, xUserAccountLinks } from "@/lib/db/schema";
import {
  MAX_SLOTS_PER_VIDEO,
  normalizeMaxSlotsPerVideo,
} from "@/lib/slots/limits";
import { buildReleaseGroupDecisions } from "@/lib/slots/userSlotCore";
import { versionedSlotWhere } from "@/lib/slots/versionedPredicate";
import { buildSlotChangeQueueBatch } from "@/lib/staticRebuild/hooks";
import {
  markPendingPublicReflection,
  type PendingPublicReflection,
} from "@/lib/staticRebuild/publicReflectionNotice";
import { isAcceptingEntries } from "@/lib/utils/eventStatus";
import { generateId } from "@/lib/utils/id";
import {
  areSlotsInSamePart,
  sortSlotsChronologically,
} from "@/lib/utils/slotGroupingCore";
import { createTraceId } from "@/lib/observability/flowTrace";

export interface SlotReserveResult extends PendingPublicReflection {
  ok: boolean;
  message?: string;
  slotId?: string;
  slotCount?: number;
  groupSize?: number;
  reason?: WriteGuardDenyReason;
}

function slotMutationOk(
  slotId: string,
  groupSize?: number,
): SlotReserveResult {
  const size = groupSize ?? 1;
  return markPendingPublicReflection(
    { ok: true, slotId, slotCount: size, groupSize: size },
    true,
  );
}

type DB = NonNullable<ReturnType<typeof getDatabase>>;
type SlotRow = typeof slots.$inferSelect;
type EventRow = typeof events.$inferSelect;
type SlotPatch = Partial<typeof slots.$inferInsert>;

type SlotBulkMutation = {
  rows: SlotRow[];
  patch: SlotPatch;
  statusGuard?: "available" | "reserved" | "submitted";
};

const reserveSchema = z.object({
  slot_id: z.string().trim().min(1),
  display_name: z.string().trim().min(1).max(80),
  consecutive_count: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_SLOTS_PER_VIDEO)
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
  unstable_rethrow(error);
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

function eventDomainLimit(event: EventRow): number {
  return normalizeMaxSlotsPerVideo(event.max_slots_per_video);
}

function applySlotPatch(
  before: SlotRow,
  patch: SlotPatch,
  now: number,
): SlotRow {
  return {
    ...before,
    ...patch,
    updated_at: now,
    version: before.version + 1,
  } as SlotRow;
}

async function runSlotPostCommit(
  flow: string,
  eventId: string,
): Promise<void> {
  await runPostCommitBestEffort(
    { flow, traceId: createTraceId() },
    [{ name: "revalidate", run: async () => { revalidateSlotViews(eventId); } }],
  );
}

function isOwnReservedSlot(row: SlotRow, userId: string): boolean {
  return row.status === "reserved" && row.reserved_by_user_id === userId;
}

function resolveSlotXUserId(guard: {
  activeXId: string | null;
  approvedXIds: string[];
}): string | null {
  return guard.activeXId && guard.approvedXIds.includes(guard.activeXId)
    ? guard.activeXId
    : null;
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

function reservationGroupScope(groupId: string, eventId: string) {
  return and(
    eq(slots.event_id, eventId),
    eq(slots.reservation_group_id, groupId),
  )!;
}

async function commitSlotMutationPlan(args: {
  db: DB;
  mutations: readonly SlotBulkMutation[];
  eventId: string;
  actorUserId: string;
  reason: string;
  extraStatements?: BatchItem<"sqlite">[];
  notificationWakeSource?: "web";
}): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const auditedIds = new Set<string>();
  const mutationStatements: BatchItem<"sqlite">[] = [];
  const expectedMutationChanges: (number | null)[] = [];
  const audits: {
    table_name: "slots";
    target_id: string;
    operation: "UPDATE";
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    actor_user_id: string;
    reason: string;
    context: string;
    retention_class: "normal";
    restore_strategy: "update_before";
    strict: true;
  }[] = [];

  for (const mutation of args.mutations) {
    if (mutation.rows.length === 0) continue;
    for (const row of mutation.rows) {
      if (auditedIds.has(row.id)) {
        throw new Error("同一枠を複数の更新に含めることはできません。");
      }
      auditedIds.add(row.id);
    }
    mutationStatements.push(
      args.db
        .update(slots)
        .set({
          ...mutation.patch,
          updated_at: now,
          version: sql`${slots.version} + 1`,
        })
        .where(
          versionedSlotWhere(
            args.eventId,
            mutation.rows,
            mutation.statusGuard,
          ),
        ),
    );
    expectedMutationChanges.push(mutation.rows.length);
    for (const before of mutation.rows) {
      audits.push({
        table_name: "slots",
        target_id: before.id,
        operation: "UPDATE",
        before: snapshot(before),
        after: snapshot(applySlotPatch(before, mutation.patch, now)),
        actor_user_id: args.actorUserId,
        reason: args.reason,
        context: "user-slot",
        retention_class: "normal",
        restore_strategy: "update_before",
        strict: true,
      });
    }
  }

  if (mutationStatements.length === 0) {
    throw new Error("更新対象の枠がありません。");
  }

  const queue = await buildSlotChangeQueueBatch(args.db, {
    eventId: args.eventId,
    reason: args.reason,
    requestedByUserId: args.actorUserId,
  });
  const extra = args.extraStatements ?? [];
  const wakeNotification =
    args.notificationWakeSource ?? (extra.length > 0 ? "web" : undefined);
  await mutateWithAudit(args.db, {
    mutationStatements: [
      ...mutationStatements,
      ...queue.statements,
      ...extra,
    ],
    expectedMutationChanges: [
      ...expectedMutationChanges,
      ...queue.expectedChanges,
      ...extra.map(() => null),
    ],
    audits,
    notificationWakeSource: wakeNotification,
    staticRebuildWakeSource: queue.statements.length > 0 ? "web" : undefined,
  });
}

function buildReleaseMutations(
  groupRows: readonly SlotRow[],
  anchorId: string,
): SlotBulkMutation[] {
  const newGroupId = generateId("sgrp");
  const decisions = new Map(
    buildReleaseGroupDecisions(groupRows, anchorId, { newGroupId }).map(
      (decision) => [decision.id, decision],
    ),
  );
  const mutations: SlotBulkMutation[] = [];
  const releasedRows = groupRows.filter(
    (row) => decisions.get(row.id)?.release,
  );
  if (releasedRows.length > 0) {
    mutations.push({
      rows: [...releasedRows],
      patch: {
        reserved_by_user_id: null,
        x_user_id: null,
        display_name: null,
        reservation_group_id: null,
        status: "available" as const,
      },
      statusGuard: "reserved",
    });
  }

  const groupByTarget = new Map<string | null, SlotRow[]>();
  for (const row of groupRows) {
    const decision = decisions.get(row.id);
    if (!decision || decision.release) continue;
    if (decision.reservation_group_id === row.reservation_group_id) continue;
    const key = decision.reservation_group_id;
    const current = groupByTarget.get(key) ?? [];
    current.push(row);
    groupByTarget.set(key, current);
  }
  for (const [targetGroupId, rows] of groupByTarget) {
    mutations.push({
      rows,
      patch: { reservation_group_id: targetGroupId },
      statusGuard: "reserved",
    });
  }
  return mutations;
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
    .limit(MAX_SLOTS_PER_VIDEO + 1);
  if (rows.length > MAX_SLOTS_PER_VIDEO) {
    throw new Error(
      `連続枠が上限 ${MAX_SLOTS_PER_VIDEO} 件を超えています。運営へ連絡してください。`,
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
  limit = 1,
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
          .limit(limit)
      : query
          .orderBy(
            desc(slots.start_time),
            desc(sql`COALESCE(${slots.sort_order}, 0)`),
            desc(slots.id),
          )
          .limit(limit);
  }
  return direction === "forward"
    ? query
        .orderBy(asc(sql`COALESCE(${slots.sort_order}, 0)`), asc(slots.id))
        .limit(limit)
    : query
        .orderBy(desc(sql`COALESCE(${slots.sort_order}, 0)`), desc(slots.id))
        .limit(limit);
}

function assertAdjacentSequence(rows: readonly SlotRow[], gapSec: number): void {
  for (let index = 1; index < rows.length; index += 1) {
    if (!areSlotsInSamePart(rows[index - 1], rows[index], gapSec)) {
      throw new Error("別の部または連続していない枠はまとめて操作できません。");
    }
  }
}

async function authUserControlsXId(
  db: DB,
  authUserId: string,
  xUserId: string,
): Promise<boolean> {
  return Boolean(
    (
      await db
        .select({ x_user_id: xUserAccountLinks.x_user_id })
        .from(xUserAccountLinks)
        .where(
          and(
            eq(xUserAccountLinks.auth_user_id, authUserId),
            eq(xUserAccountLinks.x_user_id, xUserId),
          )!,
        )
        .limit(1)
    )[0],
  );
}

async function ownsSlot(
  db: DB,
  row: SlotRow,
  userId: string,
  activeXId: string | null,
): Promise<boolean> {
  if (row.x_user_id) {
    if (row.x_user_id === activeXId) return true;
    return authUserControlsXId(db, userId, row.x_user_id);
  }
  return row.reserved_by_user_id === userId;
}

export async function reserveSlot(
  formData: FormData,
): Promise<SlotReserveResult> {
  const guard = await writeGuard({
    identityRequirement: "requested_x",
    feature: "reserve_slot",
  });
  if (!guard.ok) {
    return { ok: false, reason: guard.reason, message: guard.message };
  }
  const slotXUserId = resolveSlotXUserId(guard);
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
      if (isOwnReservedSlot(anchor, guard.user.id)) {
        const group = await loadBoundedGroup(db, anchor);
        return slotMutationOk(anchor.id, group.length);
      }
      return { ok: false, message: "この枠はすでに確保されています。" };
    }
    const event = await loadEvent(db, anchor.event_id);
    if (!event) return { ok: false, message: "イベントが見つかりません。" };
    if (!isAcceptingEntries(event)) {
      return { ok: false, message: "受付中ではないため枠を確保できません。" };
    }
    const maxRows = eventDomainLimit(event);
    if (parsed.data.consecutive_count > maxRows) {
      return {
        ok: false,
        message: `一度に確保できる連続枠は ${maxRows} 件までです。`,
      };
    }

    const targetRows = [anchor];
    if (parsed.data.consecutive_count > 1) {
      const candidates = await loadOrderedNeighbors(
        db,
        anchor,
        "forward",
        parsed.data.consecutive_count - 1,
      );
      targetRows.push(...candidates);
    }
    if (targetRows.length !== parsed.data.consecutive_count) {
      return { ok: false, message: "必要な数の連続空き枠がありません。" };
    }
    if (targetRows.some((row) => row.status !== "available")) {
      return { ok: false, message: "連続枠の途中に確保済みの枠があります。" };
    }
    assertAdjacentSequence(targetRows, slotPartGapSec(event));

    const groupId = targetRows.length > 1 ? generateId("sgrp") : null;
    const reservePatch = {
      reserved_by_user_id: guard.user.id,
      x_user_id: slotXUserId,
      display_name: parsed.data.display_name,
      reservation_group_id: groupId,
      status: "reserved" as const,
    };
    const { buildChannelSlotReservedNotification } = await import(
      "@/lib/notifications/templates/slot"
    );
    const { buildOpsChannelWebhookStatement } = await import(
      "@/lib/notifications/opsWebhook"
    );
    const actor = (
      await db
        .select({ discord_id: users.discord_id })
        .from(users)
        .where(eq(users.id, guard.user.id))
        .limit(1)
    )[0];
    const channelNotification = await buildOpsChannelWebhookStatement(db, {
      actorUserId: guard.user.id,
      payload: buildChannelSlotReservedNotification({
        eventId: anchor.event_id,
        eventTitle: event.title ?? "イベント",
        slotCount: targetRows.length,
        displayName: parsed.data.display_name,
        xUserId: slotXUserId,
        userId: guard.user.id,
        discordId: actor?.discord_id,
      }),
      dedupeKey: `channel_slot_reserved:${anchor.event_id}:${guard.user.id}:${anchor.id}:${groupId ?? "solo"}`,
      eventId: anchor.event_id,
    });
    const extraStatements: BatchItem<"sqlite">[] = [];
    let notificationWakeSource: "web" | undefined;
    if (channelNotification) {
      extraStatements.push(channelNotification.statement);
      notificationWakeSource = "web";
    }
    await commitSlotMutationPlan({
      db,
      mutations: [
        {
          rows: targetRows,
          patch: reservePatch,
          statusGuard: "available",
        },
      ],
      eventId: anchor.event_id,
      actorUserId: guard.user.id,
      reason: "slot_user_reserve",
      extraStatements,
      notificationWakeSource,
    });
    await runSlotPostCommit("slot.reserve", anchor.event_id);
    return slotMutationOk(anchor.id, targetRows.length);
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
    await commitSlotMutationPlan({
      db,
      mutations: buildReleaseMutations(groupRows, anchor.id),
      eventId: anchor.event_id,
      actorUserId: guard.user.id,
      reason: "slot_user_release",
    });
    await runSlotPostCommit("slot.release", anchor.event_id);
    return slotMutationOk(anchor.id, groupRows.length);
  } catch (error) {
    return mutationError(error);
  }
}

export async function extendOwnSlotGroup(
  formData: FormData,
): Promise<SlotReserveResult> {
  const guard = await writeGuard({
    identityRequirement: "requested_x",
    feature: "extend_slot_group",
  });
  if (!guard.ok) {
    return { ok: false, reason: guard.reason, message: guard.message };
  }
  const slotXUserId = resolveSlotXUserId(guard);
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
      !(await ownsSlot(db, anchor, guard.user.id, guard.activeXId))
    ) {
      return { ok: false, message: "自分の予約中の枠のみ拡張できます。" };
    }
    const event = await loadEvent(db, anchor.event_id);
    if (!event) return { ok: false, message: "イベントが見つかりません。" };
    if (!isAcceptingEntries(event)) {
      return { ok: false, message: "受付中ではないため枠を拡張できません。" };
    }
    const groupRows = await loadBoundedGroup(db, anchor);
    if (groupRows.length + 1 > eventDomainLimit(event)) {
      return { ok: false, message: "連続枠の上限を超えるため拡張できません。" };
    }
    if (groupRows.some((row) => row.status !== "reserved")) {
      return { ok: false, message: "予約中でない枠を含む連続枠は拡張できません。" };
    }

    const edge =
      parsed.data.direction === "backward"
        ? groupRows[0]
        : groupRows[groupRows.length - 1];
    const candidate = (
      await loadOrderedNeighbors(db, edge, parsed.data.direction, 1)
    )[0];
    if (!candidate || candidate.status !== "available") {
      return { ok: false, message: "拡張可能な隣接空き枠がありません。" };
    }
    assertAdjacentSequence(
      parsed.data.direction === "backward"
        ? [candidate, edge]
        : [edge, candidate],
      slotPartGapSec(event),
    );

    const groupXUserId = groupRows[0]?.x_user_id ?? null;
    if (
      groupXUserId != null &&
      slotXUserId != null &&
      groupXUserId !== slotXUserId
    ) {
      return {
        ok: false,
        message: "この連続枠は別の X ID で確保されているため拡張できません。",
      };
    }
    // 既存 group の主体を継承。単枠(null)から2枠へ広げるときだけ現セッション X を採用。
    const inheritedXUserId =
      groupRows.length > 1 || groupXUserId != null
        ? groupXUserId
        : slotXUserId;

    const groupId = anchor.reservation_group_id || generateId("sgrp");
    const displayName = groupRows[0].display_name;
    const candidatePatch = {
      reserved_by_user_id: guard.user.id,
      x_user_id: inheritedXUserId,
      display_name: displayName,
      reservation_group_id: groupId,
      status: "reserved" as const,
    };
    const mutations: SlotBulkMutation[] = !anchor.reservation_group_id
      ? [
          {
            rows: [anchor],
            patch: {
              reservation_group_id: groupId,
              x_user_id: inheritedXUserId,
            },
            statusGuard: "reserved",
          },
          {
            rows: [candidate],
            patch: candidatePatch,
            statusGuard: "available",
          },
        ]
      : [
          {
            rows: [candidate],
            patch: candidatePatch,
            statusGuard: "available",
          },
        ];
    await commitSlotMutationPlan({
      db,
      mutations,
      eventId: anchor.event_id,
      actorUserId: guard.user.id,
      reason: "slot_user_extend",
    });
    await runSlotPostCommit("slot.extend", anchor.event_id);
    return slotMutationOk(candidate.id, groupRows.length + 1);
  } catch (error) {
    return mutationError(error);
  }
}

export async function mergeOwnSlotGroups(
  formData: FormData,
): Promise<SlotReserveResult> {
  const guard = await writeGuard({
    identityRequirement: "requested_x",
    feature: "merge_slot_groups",
  });
  if (!guard.ok) {
    return { ok: false, reason: guard.reason, message: guard.message };
  }
  const slotXUserId = resolveSlotXUserId(guard);
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

    const left = (await loadOrderedNeighbors(db, gap, "backward", 1))[0];
    const right = (await loadOrderedNeighbors(db, gap, "forward", 1))[0];
    if (!left || !right) {
      return { ok: false, message: "結合対象の隣接枠がありません。" };
    }
    assertAdjacentSequence([left, gap, right], slotPartGapSec(event));
    if (
      left.status !== "reserved" ||
      right.status !== "reserved" ||
      !(await ownsSlot(db, left, guard.user.id, guard.activeXId)) ||
      !(await ownsSlot(db, right, guard.user.id, guard.activeXId))
    ) {
      return { ok: false, message: "自分の予約中の隣接枠どうしのみ結合できます。" };
    }
    if (left.x_user_id !== right.x_user_id) {
      return { ok: false, message: "連続枠に別の X ID が混在しているため結合できません。" };
    }

    const leftGroup = await loadBoundedGroup(db, left);
    const rightGroup = await loadBoundedGroup(db, right);
    const byId = new Map<string, SlotRow>();
    for (const row of [...leftGroup, ...rightGroup]) byId.set(row.id, row);
    const reservedRows = sortSlotsChronologically([...byId.values()]);
    for (const row of reservedRows) {
      if (
        row.status !== "reserved" ||
        !(await ownsSlot(db, row, guard.user.id, guard.activeXId))
      ) {
        return { ok: false, message: "連続枠に別の利用者または状態が混在しています。" };
      }
    }
    const subjectX = reservedRows[0]?.x_user_id ?? null;
    if (reservedRows.some((row) => row.x_user_id !== subjectX)) {
      return { ok: false, message: "連続枠に別の X ID が混在しているため結合できません。" };
    }
    if (reservedRows.length + 1 > eventDomainLimit(event)) {
      return { ok: false, message: "連続枠の上限を超えるため結合できません。" };
    }
    assertAdjacentSequence(
      sortSlotsChronologically([...reservedRows, gap]),
      slotPartGapSec(event),
    );

    const groupId = generateId("sgrp");
    const groupPatch = {
      display_name: parsed.data.display_name,
      reservation_group_id: groupId,
      x_user_id: slotXUserId,
    };
    const gapPatch = {
      reserved_by_user_id: guard.user.id,
      x_user_id: slotXUserId,
      display_name: parsed.data.display_name,
      reservation_group_id: groupId,
      status: "reserved" as const,
    };
    await commitSlotMutationPlan({
      db,
      mutations: [
        {
          rows: reservedRows,
          patch: groupPatch,
          statusGuard: "reserved",
        },
        {
          rows: [gap],
          patch: gapPatch,
          statusGuard: "available",
        },
      ],
      eventId: gap.event_id,
      actorUserId: guard.user.id,
      reason: "slot_user_merge",
    });
    await runSlotPostCommit("slot.merge", gap.event_id);
    return slotMutationOk(gap.id, reservedRows.length + 1);
  } catch (error) {
    return mutationError(error);
  }
}
