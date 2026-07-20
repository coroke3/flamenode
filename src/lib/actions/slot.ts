"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { mutateWithAudit } from "@/lib/audit/mutate";
import {
  writeGuard,
  type WriteGuardDenyReason,
} from "@/lib/auth/writeGuard";
import { isAuthUserLinkedToXUser } from "@/lib/auth/xIdentity";
import { getDatabase } from "@/lib/cloudflare";
import { events, slots, xUserAccountLinks } from "@/lib/db/schema";
import { buildStaticRebuildQueueBatch } from "@/lib/staticRebuild/enqueue";
import { isAcceptingEntries } from "@/lib/utils/eventStatus";

export interface SlotReserveResult {
  ok: boolean;
  message?: string;
  slotId?: string;
  reason?: WriteGuardDenyReason;
}

type DB = NonNullable<ReturnType<typeof getDatabase>>;
type SlotRow = typeof slots.$inferSelect;
type SlotPatch = Partial<typeof slots.$inferInsert>;

const reserveSchema = z.object({
  slot_id: z.string().trim().min(1),
  display_name: z.string().trim().min(1).max(80),
  consecutive_count: z.coerce.number().int().min(1).default(1),
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

/** 読取後に対象枠の正本列が変化していないことを確認する。 */
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
    sql`${slots.slot_label} IS ${row.slot_label}`,
    sql`${slots.start_time} IS ${row.start_time}`,
    sql`${slots.sort_order} IS ${row.sort_order}`,
    sql`${slots.reservation_group_id} IS ${row.reservation_group_id}`,
    sql`${slots.video_id} IS ${row.video_id}`,
  )!;
}

async function loadSlot(db: DB, slotId: string): Promise<SlotRow | null> {
  return (
    await db.select().from(slots).where(eq(slots.id, slotId)).limit(1)
  )[0] ?? null;
}

async function commitSlotUpdate(args: {
  db: DB;
  before: SlotRow;
  patch: SlotPatch;
  actorUserId: string;
  reason: string;
}): Promise<SlotRow> {
  const now = Math.floor(Date.now() / 1000);
  const after = {
    ...args.before,
    ...args.patch,
    updated_at: now,
    version: args.before.version + 1,
  } as SlotRow;
  const queue = await buildStaticRebuildQueueBatch(args.db, [
    {
      targetType: "event",
      targetId: args.before.event_id,
      reason: args.reason,
      priority: "high",
      requestedByUserId: args.actorUserId,
    },
  ]);
  await mutateWithAudit(args.db, {
    mutationStatements: [
      args.db
        .update(slots)
        .set({
          ...args.patch,
          updated_at: after.updated_at,
          version: after.version,
        })
        .where(expectedRowCondition(args.before)),
      ...queue.statements,
    ],
    expectedMutationChanges: [1, ...queue.expectedChanges],
    audits: [
      {
        table_name: "slots",
        target_id: args.before.id,
        operation: "UPDATE",
        before: snapshot(args.before),
        after: snapshot(after),
        actor_user_id: args.actorUserId,
        reason: args.reason,
        context: "user-slot",
        retention_class: "normal",
        restore_strategy: "update_before",
        strict: true,
      },
    ],
  });
  return after;
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
  if (parsed.data.consecutive_count !== 1) {
    return {
      ok: false,
      message: "連続枠の一括確保は廃止されました。1枠ずつ確保してください。",
    };
  }
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  try {
    const slot = await loadSlot(db, parsed.data.slot_id);
    if (!slot) return { ok: false, message: "枠が見つかりません。" };
    if (slot.status !== "available") {
      return { ok: false, message: "この枠はすでに確保されています。" };
    }
    const event = (
      await db
        .select()
        .from(events)
        .where(eq(events.id, slot.event_id))
        .limit(1)
    )[0];
    if (!event) return { ok: false, message: "イベントが見つかりません。" };
    if (!isAcceptingEntries(event)) {
      return { ok: false, message: "受付中ではないため枠を確保できません。" };
    }

    await commitSlotUpdate({
      db,
      before: slot,
      patch: {
        reserved_by_user_id: guard.user.id,
        x_user_id: guard.activeXId,
        display_name: parsed.data.display_name,
        reservation_group_id: null,
        status: "reserved",
      },
      actorUserId: guard.user.id,
      reason: "slot_user_reserve",
    });
    revalidateSlotViews(slot.event_id);
    return { ok: true, slotId: slot.id };
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
    const slot = await loadSlot(db, slotId);
    if (!slot) return { ok: false, message: "枠が見つかりません。" };
    if (!(await ownsSlot(db, slot, guard.user.id, guard.activeXId))) {
      return { ok: false, message: "自分が確保した枠のみ解放できます。" };
    }
    if (slot.status !== "reserved") {
      return {
        ok: false,
        message: "提出済みの枠は解放できません。先に作品取り下げを相談してください。",
      };
    }

    await commitSlotUpdate({
      db,
      before: slot,
      patch: {
        reserved_by_user_id: null,
        x_user_id: null,
        display_name: null,
        reservation_group_id: null,
        status: "available",
      },
      actorUserId: guard.user.id,
      reason: "slot_user_release",
    });
    revalidateSlotViews(slot.event_id);
    return { ok: true, slotId: slot.id };
  } catch (error) {
    return mutationError(error);
  }
}

/** 廃止済み連続枠機能。既存UIから呼ばれてもDBを変更しない。 */
export async function extendOwnSlotGroup(
  _formData: FormData,
): Promise<SlotReserveResult> {
  return {
    ok: false,
    message: "連続枠の拡張機能は廃止されました。1枠ずつ確保してください。",
  };
}

/** 廃止済み連続枠機能。既存UIから呼ばれてもDBを変更しない。 */
export async function mergeOwnSlotGroups(
  _formData: FormData,
): Promise<SlotReserveResult> {
  return {
    ok: false,
    message: "連続枠の結合機能は廃止されました。1枠ずつ確保してください。",
  };
}
