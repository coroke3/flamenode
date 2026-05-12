"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, asc, eq, gte } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getDatabase } from "@/lib/cloudflare";
import { events, historyLogs, slots, xUsers } from "@/lib/db/schema";
import { isAcceptingEntries } from "@/lib/utils/eventStatus";
import { generateId } from "@/lib/utils/id";
import { normalizeXId } from "@/lib/utils/xid";

export interface SlotReserveResult {
  ok: boolean;
  message?: string;
  slotId?: string;
}

const reserveSchema = z.object({
  slot_id: z.string().trim().min(1),
  display_name: z.string().trim().min(1).max(80),
  consecutive_count: z.coerce.number().min(1).max(20).default(1),
});

export async function reserveSlot(
  formData: FormData,
): Promise<SlotReserveResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "ログインが必要です。" };
  if (user.is_banned === 1) {
    return { ok: false, message: "現在、このアカウントは利用停止中です。" };
  }

  const activeX = normalizeXId(user.active_x_user_id);
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

  const xRow = (
    await db.select().from(xUsers).where(eq(xUsers.id, activeX)).limit(1)
  )[0];
  if (!xRow) return { ok: false, message: "X ID が見つかりません。" };
  if (xRow.approval_status === "rejected") {
    return { ok: false, message: "却下された X ID では枠を確保できません。" };
  }

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
  const reserveCount = Math.min(
    parsed.data.consecutive_count,
    ev.max_consecutive_slots_per_entry ?? 1,
  );
  const groupId = reserveCount > 1 ? generateId("sgrp") : null;
  const targetSlots = [slotRow];

  if (reserveCount > 1) {
    const candidates = await db
      .select()
      .from(slots)
      .where(
        and(
          eq(slots.event_id, slotRow.event_id),
          eq(slots.status, "available"),
          gte(slots.sort_order, slotRow.sort_order ?? 0),
        )!,
      )
      .orderBy(asc(slots.sort_order), asc(slots.start_time))
      .limit(reserveCount);
    if (candidates.length < reserveCount || candidates[0]?.id !== slotRow.id) {
      return {
        ok: false,
        message: "連続枠を確保できませんでした。途中に取得済みの枠があります。",
      };
    }
    targetSlots.splice(0, targetSlots.length, ...candidates);
  }

  const updatedIds: string[] = [];
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
    if (updated.length === 0) break;
    updatedIds.push(target.id);
  }

  if (updatedIds.length !== targetSlots.length) {
    return {
      ok: false,
      message: "枠確保に失敗しました。他のユーザーが先に取得した可能性があります。",
    };
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
      slot_ids: updatedIds,
      reservation_group_id: groupId,
    }),
    operator_discord_id: user.id,
    retention_class: "normal",
    created_at: now,
  });

  revalidatePath(`/event/${slotRow.event_id}`);
  revalidatePath(`/admin/events/${slotRow.event_id}/slots`);
  revalidatePath("/dashboard");
  return { ok: true, slotId: parsed.data.slot_id };
}

export async function releaseOwnSlot(
  formData: FormData,
): Promise<SlotReserveResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "ログインが必要です。" };

  const slotId = String(formData.get("slot_id") ?? "").trim();
  if (!slotId) return { ok: false, message: "slot_id が必要です。" };

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const slotRow = (
    await db.select().from(slots).where(eq(slots.id, slotId)).limit(1)
  )[0];
  if (!slotRow) return { ok: false, message: "スロットが見つかりません。" };
  if (slotRow.discord_user_id !== user.id) {
    return { ok: false, message: "自分が確保した枠のみ解放できます。" };
  }
  if (slotRow.status !== "reserved") {
    return {
      ok: false,
      message: "提出済みの枠は解放できません。先に作品取り下げを相談してください。",
    };
  }

  const now = Math.floor(Date.now() / 1000);
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
    after_data: JSON.stringify({ status: "available", released_by: "owner" }),
    operator_discord_id: user.id,
    retention_class: "normal",
    created_at: now,
  });

  revalidatePath(`/event/${slotRow.event_id}`);
  revalidatePath(`/admin/events/${slotRow.event_id}/slots`);
  revalidatePath("/dashboard");
  return { ok: true, slotId };
}
