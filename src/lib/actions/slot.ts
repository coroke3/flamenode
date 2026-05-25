"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  writeGuard,
  type WriteGuardDenyReason,
} from "@/lib/auth/writeGuard";
import { getDatabase } from "@/lib/cloudflare";
import { events, historyLogs, slots, xUsers } from "@/lib/db/schema";
import { isAcceptingEntries } from "@/lib/utils/eventStatus";
import { generateId } from "@/lib/utils/id";

export interface SlotReserveResult {
  ok: boolean;
  message?: string;
  slotId?: string;
  reason?: WriteGuardDenyReason;
}

const reserveSchema = z.object({
  slot_id: z.string().trim().min(1),
  display_name: z.string().trim().min(1).max(80),
  consecutive_count: z.coerce.number().min(1).max(20).default(1),
});

type SlotRow = typeof slots.$inferSelect;

async function rollbackReservedSlots(
  db: NonNullable<ReturnType<typeof getDatabase>>,
  originals: SlotRow[],
  now: number,
): Promise<void> {
  if (originals.length === 0) return;
  for (const original of originals) {
    await db
      .update(slots)
      .set({
        discord_user_id: original.discord_user_id,
        x_user_id: original.x_user_id,
        display_name: original.display_name,
        reservation_group_id: original.reservation_group_id,
        status: original.status,
        updated_at: now,
      })
      .where(eq(slots.id, original.id));
  }
}

function isAdjacent(prev: SlotRow, next: SlotRow): boolean {
  if (prev.slot_kind === "time") {
    const prevEnd = prev.end_time ?? prev.start_time;
    const nextStart = next.start_time;
    if (!prevEnd || !nextStart) return false;
    return Math.abs(nextStart - prevEnd) <= 60;
  }
  const prevOrder = prev.sort_order;
  const nextOrder = next.sort_order;
  if (prevOrder == null || nextOrder == null) return false;
  return nextOrder === prevOrder + 1;
}

function reservationGroupScope(groupId: string, row: SlotRow) {
  return and(
    eq(slots.reservation_group_id, groupId),
    eq(slots.event_id, row.event_id),
    row.discord_user_id
      ? eq(slots.discord_user_id, row.discord_user_id)
      : isNull(slots.discord_user_id),
    row.x_user_id ? eq(slots.x_user_id, row.x_user_id) : isNull(slots.x_user_id),
  )!;
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
  const user = guard.user;
  const activeX = guard.activeXId;
  if (!activeX) {
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

  const slotRow = (
    await db.select().from(slots).where(eq(slots.id, parsed.data.slot_id)).limit(1)
  )[0];
  if (!slotRow) return { ok: false, message: "スロットが見つかりません。" };
  if (slotRow.status !== "available") {
    return { ok: false, message: "この枠はすでに確保されています。" };
  }

  const ev = (
    await db.select().from(events).where(eq(events.id, slotRow.event_id)).limit(1)
  )[0];
  if (!ev) return { ok: false, message: "イベントが見つかりません。" };
  if (!isAcceptingEntries(ev)) {
    return { ok: false, message: "受付中ではないため枠を確保できません。" };
  }

  const now = Math.floor(Date.now() / 1000);
  const maxConsecutive = ev.max_consecutive_slots_per_entry ?? 1;
  const reserveCount = Math.min(parsed.data.consecutive_count, maxConsecutive);
  const groupId = reserveCount > 1 ? generateId("sgrp") : null;
  let targetSlots: SlotRow[] = [slotRow];

  if (reserveCount > 1) {
    const candidates = await db
      .select()
      .from(slots)
      .where(
        and(
          eq(slots.event_id, slotRow.event_id),
          eq(slots.status, "available"),
        )!,
      )
      .orderBy(asc(slots.sort_order), asc(slots.start_time));
    const startIdx = candidates.findIndex((c) => c.id === slotRow.id);
    if (startIdx < 0) {
      return { ok: false, message: "連続枠を確保できませんでした。" };
    }
    const window = candidates.slice(startIdx, startIdx + reserveCount);
    if (window.length < reserveCount) {
      return {
        ok: false,
        message: "連続枠を確保できませんでした。途中に取得済みの枠があります。",
      };
    }
    for (let i = 1; i < window.length; i += 1) {
      if (!isAdjacent(window[i - 1], window[i])) {
        return {
          ok: false,
          message:
            slotRow.slot_kind === "time"
              ? "連続枠を確保できませんでした。時間が連続していません。"
              : "連続枠を確保できませんでした。枠番号が連続していません。",
        };
      }
    }
    targetSlots = window;
  }

  const updatedOriginals: SlotRow[] = [];
  let failure: string | null = null;
  for (const target of targetSlots) {
    const updated = await db
      .update(slots)
      .set({
        discord_user_id: user.id,
        x_user_id: activeX,
        display_name: parsed.data.display_name,
        reservation_group_id: groupId,
        status: "reserved",
        updated_at: now,
      })
      .where(and(eq(slots.id, target.id), eq(slots.status, "available"))!)
      .returning({ id: slots.id });
    if (updated.length === 0) {
      failure =
        "枠確保に失敗しました。他のユーザーが先に取得した可能性があります。";
      break;
    }
    updatedOriginals.push(target);
  }

  if (failure) {
    await rollbackReservedSlots(db, updatedOriginals, now);
    return { ok: false, message: failure };
  }

  await db.insert(historyLogs).values({
    table_name: "slots",
    record_id: parsed.data.slot_id,
    action: "UPDATE",
    after_data: JSON.stringify({
      status: "reserved",
      x_user_id: activeX,
      discord_user_id: user.id,
      display_name: parsed.data.display_name,
      slot_ids: updatedOriginals.map((r) => r.id),
      reservation_group_id: groupId,
    }),
    operator_discord_id: user.id,
    retention_class: "normal",
    created_at: now,
  });

  revalidatePath(`/event/${slotRow.event_id}`);
  revalidatePath(`/event/${slotRow.event_id}/slots`);
  revalidatePath(`/admin/events/${slotRow.event_id}/slots`);
  revalidatePath("/dashboard");
  return { ok: true, slotId: parsed.data.slot_id };
}

export async function releaseOwnSlot(
  formData: FormData,
): Promise<SlotReserveResult> {
  const guard = await writeGuard({ feature: "release_slot" });
  if (!guard.ok) {
    return { ok: false, reason: guard.reason, message: guard.message };
  }
  const user = guard.user;
  const activeX = guard.activeXId;

  const slotId = String(formData.get("slot_id") ?? "").trim();
  if (!slotId) return { ok: false, message: "slot_id が必要です。" };

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const slotRow = (
    await db.select().from(slots).where(eq(slots.id, slotId)).limit(1)
  )[0];
  if (!slotRow) return { ok: false, message: "スロットが見つかりません。" };
  // slot owner 判定: 現在 active な X ID 一致が原則だが、確保時の X が linked された
  // ままで active から外れているだけのケースを救済する。
  // xUsers.linked_discord_user_id === user.id なら自分の枠とみなす。
  let isOwner = false;
  if (slotRow.x_user_id) {
    if (slotRow.x_user_id === activeX) {
      isOwner = true;
    } else {
      const linkedXOwner = (
        await db
          .select({ id: xUsers.id })
          .from(xUsers)
          .where(
            and(
              eq(xUsers.id, slotRow.x_user_id),
              eq(xUsers.linked_discord_user_id, user.id),
            )!,
          )
          .limit(1)
      )[0];
      if (linkedXOwner) isOwner = true;
    }
  } else {
    isOwner = slotRow.discord_user_id === user.id;
  }
  if (!isOwner) {
    return { ok: false, message: "自分が確保した枠のみ解放できます。" };
  }
  if (slotRow.status !== "reserved") {
    return {
      ok: false,
      message: "提出済みの枠は解放できません。先に作品取り下げを相談してください。",
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const groupId = slotRow.reservation_group_id;

  if (!groupId) {
    await db
      .update(slots)
      .set({
        discord_user_id: null,
        x_user_id: null,
        display_name: null,
        reservation_group_id: null,
        status: "available",
        updated_at: now,
      })
      .where(eq(slots.id, slotId));

    await db.insert(historyLogs).values({
      table_name: "slots",
      record_id: slotId,
      action: "UPDATE",
      after_data: JSON.stringify({
        status: "available",
        released_by: "owner",
        slot_ids: [slotId],
        reservation_group_id: null,
      }),
      operator_discord_id: user.id,
      retention_class: "normal",
      created_at: now,
    });
    revalidatePath(`/event/${slotRow.event_id}`);
    revalidatePath(`/event/${slotRow.event_id}/slots`);
    revalidatePath(`/admin/events/${slotRow.event_id}/slots`);
    revalidatePath("/dashboard");
    return { ok: true, slotId };
  }

  const groupRows = await db
    .select()
    .from(slots)
    .where(reservationGroupScope(groupId, slotRow))
    .orderBy(asc(slots.sort_order), asc(slots.start_time));

  if (groupRows.some((r) => r.status === "submitted")) {
    return {
      ok: false,
      message:
        "提出済みの枠を含むグループは通常解放できません。先に作品取り下げを相談してください。",
    };
  }
  if (
    groupRows.some(
      (r) =>
        r.x_user_id !== slotRow.x_user_id ||
        r.discord_user_id !== slotRow.discord_user_id ||
        r.event_id !== slotRow.event_id,
    )
  ) {
    return {
      ok: false,
      message: "グループ内に他ユーザー / 別 X ID の枠が混在しています。",
    };
  }

  const targetIdx = groupRows.findIndex((r) => r.id === slotId);
  if (targetIdx < 0) {
    // 直前で slotRow.reservation_group_id が一致しているはずだが、レース等で
    // グループから外れていた場合 split 計算が暴発するため明示的に拒否する。
    return {
      ok: false,
      message:
        "スロットグループの整合性に問題があります。管理者に連絡してください。",
    };
  }
  const isEdge =
    targetIdx === 0 || targetIdx === groupRows.length - 1 || groupRows.length <= 2;

  await db
    .update(slots)
    .set({
      discord_user_id: null,
      x_user_id: null,
      display_name: null,
      reservation_group_id: null,
      status: "available",
      updated_at: now,
    })
    .where(eq(slots.id, slotId));

  let splitInfo: {
    leftGroupId: string | null;
    rightGroupId: string | null;
  } = { leftGroupId: null, rightGroupId: null };

  if (groupRows.length <= 2) {
    if (groupRows.length === 2) {
      const remaining = groupRows.find((r) => r.id !== slotId);
      if (remaining) {
        await db
          .update(slots)
          .set({ reservation_group_id: null, updated_at: now })
          .where(eq(slots.id, remaining.id));
      }
    }
  } else if (!isEdge) {
    const left = groupRows.slice(0, targetIdx);
    const right = groupRows.slice(targetIdx + 1);
    const leftGroupId = left.length >= 2 ? generateId("sgrp") : null;
    const rightGroupId = right.length >= 2 ? generateId("sgrp") : null;
    await db
      .update(slots)
      .set({ reservation_group_id: leftGroupId, updated_at: now })
      .where(
        inArray(
          slots.id,
          left.map((r) => r.id),
        ),
      );
    await db
      .update(slots)
      .set({ reservation_group_id: rightGroupId, updated_at: now })
      .where(
        inArray(
          slots.id,
          right.map((r) => r.id),
        ),
      );
    splitInfo = { leftGroupId, rightGroupId };
  } else {
    const remaining = groupRows.filter((r) => r.id !== slotId);
    if (remaining.length === 1) {
      await db
        .update(slots)
        .set({ reservation_group_id: null, updated_at: now })
        .where(eq(slots.id, remaining[0].id));
    }
  }

  await db.insert(historyLogs).values({
    table_name: "slots",
    record_id: slotId,
    action: "UPDATE",
    after_data: JSON.stringify({
      status: "available",
      released_by: "owner",
      slot_ids: [slotId],
      reservation_group_id: groupId,
      split: splitInfo,
    }),
    operator_discord_id: user.id,
    retention_class: "normal",
    created_at: now,
  });

  revalidatePath(`/event/${slotRow.event_id}`);
  revalidatePath(`/event/${slotRow.event_id}/slots`);
  revalidatePath(`/admin/events/${slotRow.event_id}/slots`);
  revalidatePath("/dashboard");
  return { ok: true, slotId };
}

const extendSchema = z.object({
  slot_id: z.string().trim().min(1),
  direction: z.enum(["forward", "backward"]),
});

/** 自分のグループに前方/後方の隣接 available 枠を 1 つ追加する。 */
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
  const user = guard.user;
  const activeX = guard.activeXId;
  if (!activeX) {
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

  const anchor = (
    await db.select().from(slots).where(eq(slots.id, parsed.data.slot_id)).limit(1)
  )[0];
  if (!anchor) return { ok: false, message: "スロットが見つかりません。" };
  if (anchor.status !== "reserved") {
    return { ok: false, message: "予約中の枠のみ拡張できます。" };
  }
  if (anchor.x_user_id !== activeX || anchor.discord_user_id !== user.id) {
    return { ok: false, message: "自分の枠のみ拡張できます。" };
  }

  const ev = (
    await db.select().from(events).where(eq(events.id, anchor.event_id)).limit(1)
  )[0];
  if (!ev) return { ok: false, message: "イベントが見つかりません。" };
  if (!isAcceptingEntries(ev)) {
    return { ok: false, message: "受付中ではないため枠を拡張できません。" };
  }

  const groupId = anchor.reservation_group_id;
  const currentGroup = groupId
    ? await db
        .select()
        .from(slots)
        .where(reservationGroupScope(groupId, anchor))
        .orderBy(asc(slots.sort_order), asc(slots.start_time))
    : [anchor];

  if (
    currentGroup.some(
      (r) => r.x_user_id !== activeX || r.discord_user_id !== user.id,
    )
  ) {
    return {
      ok: false,
      message: "グループ内に他ユーザー / 別 X ID の枠が混在しています。",
    };
  }

  const maxConsecutive = ev.max_consecutive_slots_per_entry ?? 1;
  if (currentGroup.length + 1 > maxConsecutive) {
    return { ok: false, message: "連続枠の上限を超えるため拡張できません。" };
  }

  const edge =
    parsed.data.direction === "backward"
      ? currentGroup[0]
      : currentGroup[currentGroup.length - 1];

  const allEventSlots = await db
    .select()
    .from(slots)
    .where(
      and(eq(slots.event_id, anchor.event_id), eq(slots.status, "available"))!,
    )
    .orderBy(asc(slots.sort_order), asc(slots.start_time));

  const candidate = allEventSlots.find((r) => {
    if (parsed.data.direction === "backward") return isAdjacent(r, edge);
    return isAdjacent(edge, r);
  });
  if (!candidate) {
    return { ok: false, message: "拡張可能な隣接空き枠がありません。" };
  }
  if (candidate.slot_kind !== anchor.slot_kind) {
    return { ok: false, message: "slot_kind が異なるため拡張できません。" };
  }

  const now = Math.floor(Date.now() / 1000);
  const nextGroupId = groupId ?? generateId("sgrp");
  const displayName = currentGroup[0].display_name;

  const updated = await db
    .update(slots)
    .set({
      discord_user_id: user.id,
      x_user_id: activeX,
      display_name: displayName,
      reservation_group_id: nextGroupId,
      status: "reserved",
      updated_at: now,
    })
    .where(and(eq(slots.id, candidate.id), eq(slots.status, "available"))!)
    .returning({ id: slots.id });
  if (updated.length === 0) {
    return {
      ok: false,
      message: "拡張に失敗しました。他のユーザーが先に取得した可能性があります。",
    };
  }

  if (!groupId) {
    await db
      .update(slots)
      .set({ reservation_group_id: nextGroupId, updated_at: now })
      .where(eq(slots.id, anchor.id));
  }

  await db.insert(historyLogs).values({
    table_name: "slots",
    record_id: candidate.id,
    action: "UPDATE",
    after_data: JSON.stringify({
      status: "reserved",
      extended_by: "owner",
      anchor_slot_id: anchor.id,
      direction: parsed.data.direction,
      reservation_group_id: nextGroupId,
    }),
    operator_discord_id: user.id,
    retention_class: "normal",
    created_at: now,
  });

  revalidatePath(`/event/${anchor.event_id}`);
  revalidatePath(`/event/${anchor.event_id}/slots`);
  revalidatePath(`/admin/events/${anchor.event_id}/slots`);
  revalidatePath("/dashboard");
  return { ok: true, slotId: candidate.id };
}

const mergeSchema = z.object({
  gap_slot_id: z.string().trim().min(1),
  display_name: z.string().trim().min(1).max(80),
});

/** 左右の同一主体グループの間にある単一 available 枠を埋めて 1 グループに結合する。 */
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
  const user = guard.user;
  const activeX = guard.activeXId;
  if (!activeX) {
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

  const gap = (
    await db.select().from(slots).where(eq(slots.id, parsed.data.gap_slot_id)).limit(1)
  )[0];
  if (!gap) return { ok: false, message: "スロットが見つかりません。" };
  if (gap.status !== "available") {
    return { ok: false, message: "対象の枠はすでに確保されています。" };
  }

  const ev = (
    await db.select().from(events).where(eq(events.id, gap.event_id)).limit(1)
  )[0];
  if (!ev) return { ok: false, message: "イベントが見つかりません。" };
  if (!isAcceptingEntries(ev)) {
    return { ok: false, message: "受付中ではないため結合できません。" };
  }

  const eventSlots = await db
    .select()
    .from(slots)
    .where(eq(slots.event_id, gap.event_id))
    .orderBy(asc(slots.sort_order), asc(slots.start_time));

  const gapIdx = eventSlots.findIndex((r) => r.id === gap.id);
  if (gapIdx < 0) return { ok: false, message: "スロットが見つかりません。" };
  const leftNeighbor = eventSlots[gapIdx - 1];
  const rightNeighbor = eventSlots[gapIdx + 1];
  if (!leftNeighbor || !rightNeighbor) {
    return { ok: false, message: "結合対象の隣接枠がありません。" };
  }
  if (!isAdjacent(leftNeighbor, gap) || !isAdjacent(gap, rightNeighbor)) {
    return { ok: false, message: "隣接していない枠は結合できません。" };
  }
  if (
    leftNeighbor.slot_kind !== gap.slot_kind ||
    rightNeighbor.slot_kind !== gap.slot_kind
  ) {
    return { ok: false, message: "slot_kind が異なるため結合できません。" };
  }
  if (
    leftNeighbor.status !== "reserved" ||
    rightNeighbor.status !== "reserved"
  ) {
    return { ok: false, message: "両隣が予約中のときのみ結合できます。" };
  }
  if (
    leftNeighbor.x_user_id !== activeX ||
    rightNeighbor.x_user_id !== activeX ||
    leftNeighbor.discord_user_id !== user.id ||
    rightNeighbor.discord_user_id !== user.id
  ) {
    return { ok: false, message: "自分の枠どうしのみ結合できます。" };
  }

  const leftGroupId = leftNeighbor.reservation_group_id;
  const rightGroupId = rightNeighbor.reservation_group_id;

  const leftGroup = leftGroupId
    ? await db
        .select()
        .from(slots)
        .where(reservationGroupScope(leftGroupId, leftNeighbor))
    : [leftNeighbor];
  const rightGroup = rightGroupId
    ? await db
        .select()
        .from(slots)
        .where(reservationGroupScope(rightGroupId, rightNeighbor))
    : [rightNeighbor];

  for (const r of [...leftGroup, ...rightGroup]) {
    if (r.x_user_id !== activeX || r.discord_user_id !== user.id) {
      return {
        ok: false,
        message: "グループ内に他ユーザー / 別 X ID の枠が混在しています。",
      };
    }
    if (r.status === "submitted") {
      return {
        ok: false,
        message: "提出済みの枠を含むグループは結合できません。",
      };
    }
  }

  const maxConsecutive = ev.max_consecutive_slots_per_entry ?? 1;
  const finalSize = leftGroup.length + rightGroup.length + 1;
  if (finalSize > maxConsecutive) {
    return { ok: false, message: "連続枠の上限を超えるため結合できません。" };
  }

  const now = Math.floor(Date.now() / 1000);
  const mergedGroupId = generateId("sgrp");
  const displayName = parsed.data.display_name;

  const updatedGap = await db
    .update(slots)
    .set({
      discord_user_id: user.id,
      x_user_id: activeX,
      display_name: displayName,
      reservation_group_id: mergedGroupId,
      status: "reserved",
      updated_at: now,
    })
    .where(and(eq(slots.id, gap.id), eq(slots.status, "available"))!)
    .returning({ id: slots.id });
  if (updatedGap.length === 0) {
    return {
      ok: false,
      message: "結合に失敗しました。中間枠が他のユーザーに取得された可能性があります。",
    };
  }

  await db
    .update(slots)
    .set({
      display_name: displayName,
      reservation_group_id: mergedGroupId,
      updated_at: now,
    })
    .where(
      inArray(slots.id, [...leftGroup, ...rightGroup].map((r) => r.id)),
    );

  await db.insert(historyLogs).values({
    table_name: "slots",
    record_id: gap.id,
    action: "UPDATE",
    after_data: JSON.stringify({
      status: "reserved",
      merged_by: "owner",
      gap_slot_id: gap.id,
      reservation_group_id: mergedGroupId,
      left_group_id: leftGroupId,
      right_group_id: rightGroupId,
      slot_ids: [
        ...leftGroup.map((r) => r.id),
        gap.id,
        ...rightGroup.map((r) => r.id),
      ],
    }),
    operator_discord_id: user.id,
    retention_class: "normal",
    created_at: now,
  });

  revalidatePath(`/event/${gap.event_id}`);
  revalidatePath(`/event/${gap.event_id}/slots`);
  revalidatePath(`/admin/events/${gap.event_id}/slots`);
  revalidatePath("/dashboard");
  return { ok: true, slotId: gap.id };
}
