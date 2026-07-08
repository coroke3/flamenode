"use server";
import { auditAction } from "@/lib/audit/helpers";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import { assertCanEditEvent } from "@/lib/auth/ownership";
import { slots } from "@/lib/db/schema";
import { parseJstDatetimeLocal } from "@/lib/utils/dateInput";
import { generateId } from "@/lib/utils/id";
import { enqueueNotification } from "@/lib/notifications/enqueue";

export interface SlotActionResult {
  ok: boolean;
  message?: string;
  created?: number;
}

const batchSchema = z.object({
  event_id: z.string().trim().min(1),
  mode: z.enum(["time", "count"]),
  start_at: z.string().optional().nullable(),
  end_at: z.string().optional().nullable(),
  interval_minutes: z.coerce.number().min(1).max(60 * 24).default(5),
  count: z.coerce.number().min(1).max(500).default(1),
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

async function ensureCanEditSlots(eventId: string): Promise<
  | { ok: true; userId: string }
  | { ok: false; result: SlotActionResult }
> {
  const session = await auth().catch(() => null);
  const u = session?.user as { id?: string; role?: string } | undefined;
  if (!u?.id) {
    return {
      ok: false,
      result: { ok: false, message: "ログインが必要です。" },
    };
  }
  const db = getDatabase();
  if (!db)
    return {
      ok: false,
      result: { ok: false, message: "DB に接続できません。" },
    };
  try {
    await assertCanEditEvent(
      db,
      { id: u.id, role: u.role ?? null },
      eventId,
      "event.slots",
    );
  } catch (e) {
    return {
      ok: false,
      result: {
        ok: false,
        message: e instanceof Error ? e.message : "権限がありません。",
      },
    };
  }
  return { ok: true, userId: u.id };
}

/** スロット一括生成。time モードと count モードを切替。 */
export async function generateSlotsBatch(
  formData: FormData,
): Promise<SlotActionResult> {
  const parsed = batchSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "入力エラー",
    };
  }
  const data = parsed.data;
  const guard = await ensureCanEditSlots(data.event_id);
  if (!guard.ok) return guard.result;

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const now = Math.floor(Date.now() / 1000);
  const created: { id: string }[] = [];

  if (data.mode === "time") {
    const startTs = parseDateInput(data.start_at);
    const endTs = parseDateInput(data.end_at);
    if (!startTs || !endTs) {
      return { ok: false, message: "開始・終了日時を指定してください。" };
    }
    if (endTs <= startTs) {
      return { ok: false, message: "終了時刻は開始より後にしてください。" };
    }
    const intervalSec = data.interval_minutes * 60;
    let cursor = startTs;
    let order = 0;
    while (cursor + intervalSec <= endTs && order < 500) {
      const id = generateId("slot");
      await db.insert(slots).values({
        id,
        event_id: data.event_id,
        slot_kind: "time",
        slot_label: null,
        start_time: cursor,
        sort_order: order,
        status: "available",
        updated_at: now,
      });
      created.push({ id });
      cursor += intervalSec;
      order += 1;
    }
  } else {
    // count モード
    if (data.count < 1) {
      return { ok: false, message: "作成数は 1 以上で指定してください。" };
    }
    const cnt = data.count;
    if (cnt > 500) {
      return { ok: false, message: "一度に作成できるのは 500 枠までです。" };
    }
    const prefix = (data.label_prefix ?? "").trim() || "No.";
    const startIndex = Math.max(1, data.start_index || 1);
    for (let i = 0; i < cnt; i++) {
      const id = generateId("slot");
      await db.insert(slots).values({
        id,
        event_id: data.event_id,
        slot_kind: "count",
        slot_label: `${prefix}${startIndex + i}`,
        start_time: null,
        sort_order: startIndex + i,
        status: "available",
        updated_at: now,
      });
      created.push({ id });
    }
  }

  await auditAction(db, {
    table_name: "slots",
    record_id: data.event_id,
    action: "CREATE",
    after_data: JSON.stringify({
      mode: data.mode,
      count: created.length,
      event_id: data.event_id,
    }),
    operator_discord_id: guard.userId,
    retention_class: "normal",

  });

  revalidateEventSlotPaths(data.event_id);
  return { ok: true, created: created.length };
}

/** available 状態のスロットを一括削除。 */
export async function deleteAvailableSlots(
  formData: FormData,
): Promise<SlotActionResult> {
  const eventId = String(formData.get("event_id") ?? "").trim();
  if (!eventId) return { ok: false, message: "event_id が必要です。" };
  const guard = await ensureCanEditSlots(eventId);
  if (!guard.ok) return guard.result;

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const now = Math.floor(Date.now() / 1000);
  const rows = await db
    .select({ id: slots.id })
    .from(slots)
    .where(and(eq(slots.event_id, eventId), eq(slots.status, "available"))!);
  for (const r of rows) {
    await db.delete(slots).where(eq(slots.id, r.id));
  }

  await auditAction(db, {
    table_name: "slots",
    record_id: eventId,
    action: "DELETE",
    after_data: JSON.stringify({ deleted: rows.length, scope: "available" }),
    operator_discord_id: guard.userId,
    retention_class: "normal",

  });

  revalidateEventSlotPaths(eventId);
  return { ok: true, created: rows.length };
}

/** 単一枠の解放: reserved → available に戻す (admin operator override)。 */
export async function releaseSlot(formData: FormData): Promise<SlotActionResult> {
  const slotId = String(formData.get("slot_id") ?? "").trim();
  if (!slotId) return { ok: false, message: "slot_id が必要です。" };
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
  const row = (
    await db.select().from(slots).where(eq(slots.id, slotId)).limit(1)
  )[0];
  if (!row) return { ok: false, message: "枠が見つかりません。" };

  const guard = await ensureCanEditSlots(row.event_id);
  if (!guard.ok) return guard.result;

  const now = Math.floor(Date.now() / 1000);
  const groupId = row.reservation_group_id;
  let targetIds = [slotId];
  if (groupId) {
    const groupRows = await db
      .select({ id: slots.id, status: slots.status })
      .from(slots)
      .where(
        and(
          eq(slots.reservation_group_id, groupId),
          eq(slots.event_id, row.event_id),
          row.discord_user_id
            ? eq(slots.discord_user_id, row.discord_user_id)
            : isNull(slots.discord_user_id),
          row.x_user_id ? eq(slots.x_user_id, row.x_user_id) : isNull(slots.x_user_id),
        )!,
      );
    if (groupRows.some((r) => r.status !== "reserved")) {
      return {
        ok: false,
        message: "提出済みの枠は解放できません。先に作品取り下げを相談してください。",
      };
    }
    await db
      .update(slots)
      .set({
        status: "available",
        discord_user_id: null,
        x_user_id: null,
        display_name: null,
        reservation_group_id: null,
        video_id: null,
        updated_at: now,
      })
      .where(
        and(
          eq(slots.reservation_group_id, groupId),
          eq(slots.event_id, row.event_id),
          row.discord_user_id
            ? eq(slots.discord_user_id, row.discord_user_id)
            : isNull(slots.discord_user_id),
          row.x_user_id ? eq(slots.x_user_id, row.x_user_id) : isNull(slots.x_user_id),
        )!,
      );
    targetIds = groupRows.map((r) => r.id);
  } else {
    await db
      .update(slots)
      .set({
        status: "available",
        discord_user_id: null,
        x_user_id: null,
        display_name: null,
        reservation_group_id: null,
        video_id: null,
        updated_at: now,
      })
      .where(eq(slots.id, slotId));
  }

  await auditAction(db, {
    table_name: "slots",
    record_id: slotId,
    action: "UPDATE",
    before_data: JSON.stringify({ status: row.status, x_user_id: row.x_user_id }),
    after_data: JSON.stringify({
      status: "available",
      forced_release: true,
      slot_ids: targetIds,
      reservation_group_id: groupId ?? null,
    }),
    operator_discord_id: guard.userId,
    retention_class: "long_audit",

  });

  // 通知: スロット所有者 (Discord) に強制解放を伝える。
  if (row.discord_user_id) {
    await enqueueNotification(db, {
      discordUserId: row.discord_user_id,
      type: "slot_force_released",
      dedupeKey: `slot_force_released:${row.event_id}:${slotId}:${groupId ?? "solo"}`,
      payload: {
        content: `運営によりイベント枠 (${targetIds.length}枠) が解放されました。`,
        slot_ids: targetIds,
        event_id: row.event_id,
        reservation_group_id: groupId ?? null,
      },
      eventId: row.event_id,
    });
  }

  revalidateEventSlotPaths(row.event_id);
  return { ok: true };
}

/** スロット個別削除 (available のみ)。 */
export async function deleteSlot(formData: FormData): Promise<SlotActionResult> {
  const slotId = String(formData.get("slot_id") ?? "").trim();
  if (!slotId) return { ok: false, message: "slot_id が必要です。" };
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
  const row = (
    await db.select().from(slots).where(eq(slots.id, slotId)).limit(1)
  )[0];
  if (!row) return { ok: false, message: "枠が見つかりません。" };
  if (row.status !== "available") {
    return {
      ok: false,
      message: "確保済 / 提出済の枠は削除できません。先に解放してください。",
    };
  }

  const guard = await ensureCanEditSlots(row.event_id);
  if (!guard.ok) return guard.result;

  const now = Math.floor(Date.now() / 1000);
  await db.delete(slots).where(eq(slots.id, slotId));
  await auditAction(db, {
    table_name: "slots",
    record_id: slotId,
    action: "DELETE",
    before_data: JSON.stringify({ event_id: row.event_id }),
    operator_discord_id: guard.userId,
    retention_class: "normal",

  });

  revalidateEventSlotPaths(row.event_id);
  return { ok: true };
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

/** 選択した空き枠を一括削除。 */
export async function batchDeleteAvailableSlots(
  formData: FormData,
): Promise<SlotActionResult> {
  const eventId = String(formData.get("event_id") ?? "").trim();
  const slotIds = parseSlotIds(formData);
  if (!eventId) return { ok: false, message: "event_id が必要です。" };
  if (slotIds.length === 0) return { ok: false, message: "枠が選択されていません。" };

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
  const guard = await ensureCanEditSlots(eventId);
  if (!guard.ok) return guard.result;

  const rows = await db
    .select()
    .from(slots)
    .where(and(eq(slots.event_id, eventId), inArray(slots.id, slotIds))!);

  const invalid = rows.filter((r) => r.status !== "available");
  if (invalid.length > 0) {
    return {
      ok: false,
      message: `空き枠以外が ${invalid.length} 件含まれています。`,
    };
  }
  if (rows.length === 0) return { ok: false, message: "対象枠が見つかりません。" };

  const now = Math.floor(Date.now() / 1000);
  await db.delete(slots).where(inArray(slots.id, slotIds));
  for (const row of rows) {
    await auditAction(db, {
      table_name: "slots",
      record_id: row.id,
      action: "DELETE",
      before_data: JSON.stringify({ event_id: eventId, batch: true }),
      operator_discord_id: guard.userId,
      retention_class: "normal",

    });
  }

  revalidateEventSlotPaths(eventId);
  return { ok: true, message: `${rows.length} 件の空き枠を削除しました。` };
}

/** 選択した確保済枠を一括解放。 */
export async function batchReleaseReservedSlots(
  formData: FormData,
): Promise<SlotActionResult> {
  const eventId = String(formData.get("event_id") ?? "").trim();
  const slotIds = parseSlotIds(formData);
  if (!eventId) return { ok: false, message: "event_id が必要です。" };
  if (slotIds.length === 0) return { ok: false, message: "枠が選択されていません。" };

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
  const guard = await ensureCanEditSlots(eventId);
  if (!guard.ok) return guard.result;

  const rows = await db
    .select()
    .from(slots)
    .where(and(eq(slots.event_id, eventId), inArray(slots.id, slotIds))!);

  const invalid = rows.filter((r) => r.status !== "reserved");
  if (invalid.length > 0) {
    return {
      ok: false,
      message: `確保済以外が ${invalid.length} 件含まれています。`,
    };
  }
  if (rows.length === 0) return { ok: false, message: "対象枠が見つかりません。" };

  const now = Math.floor(Date.now() / 1000);
  const releasedGroups = new Set<string>();

  for (const row of rows) {
    const groupId = row.reservation_group_id?.trim() || null;
    if (groupId && releasedGroups.has(groupId)) continue;

    const targetIds = groupId
      ? (
          await db
            .select({ id: slots.id })
            .from(slots)
            .where(
              and(
                eq(slots.event_id, eventId),
                eq(slots.reservation_group_id, groupId),
                eq(slots.status, "reserved"),
              )!,
            )
        ).map((s) => s.id)
      : [row.id];

    await db
      .update(slots)
      .set({
        status: "available",
        x_user_id: null,
        discord_user_id: null,
        display_name: null,
        reservation_group_id: null,
        video_id: null,
        updated_at: now,
      })
      .where(inArray(slots.id, targetIds));

    if (groupId) releasedGroups.add(groupId);

    await auditAction(db, {
      table_name: "slots",
      record_id: row.id,
      action: "UPDATE",
      before_data: JSON.stringify({ status: "reserved", batch: true }),
      after_data: JSON.stringify({
        status: "available",
        forced_release: true,
        slot_ids: targetIds,
      }),
      operator_discord_id: guard.userId,
      retention_class: "long_audit",

    });
  }

  revalidateEventSlotPaths(eventId);
  return { ok: true, message: `${rows.length} 件の確保済枠を解放しました。` };
}

/** 選択枠のラベルを一括変更。 */
export async function batchUpdateSlotLabels(
  formData: FormData,
): Promise<SlotActionResult> {
  const eventId = String(formData.get("event_id") ?? "").trim();
  const slotIds = parseSlotIds(formData);
  const label = String(formData.get("label") ?? "").trim();
  if (!eventId) return { ok: false, message: "event_id が必要です。" };
  if (slotIds.length === 0) return { ok: false, message: "枠が選択されていません。" };
  if (!label) return { ok: false, message: "ラベルを入力してください。" };

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
  const guard = await ensureCanEditSlots(eventId);
  if (!guard.ok) return guard.result;

  const rows = await db
    .select({ id: slots.id })
    .from(slots)
    .where(and(eq(slots.event_id, eventId), inArray(slots.id, slotIds))!);

  if (rows.length === 0) return { ok: false, message: "対象枠が見つかりません。" };

  const now = Math.floor(Date.now() / 1000);
  await db
    .update(slots)
    .set({ slot_label: label, updated_at: now })
    .where(inArray(slots.id, slotIds));

  revalidateEventSlotPaths(eventId);
  return { ok: true, message: `${rows.length} 件のラベルを更新しました。` };
}
