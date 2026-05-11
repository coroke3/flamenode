"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import { assertCanEditEvent } from "@/lib/auth/ownership";
import { historyLogs, slots } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";

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
  duration_minutes: z.coerce.number().min(1).max(60 * 24).default(5),
  count: z.coerce.number().min(0).max(500).default(0),
  label_prefix: z.string().trim().max(40).optional().nullable(),
  start_index: z.coerce.number().min(0).max(9999).default(1),
});

function parseDateInput(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return null;
  return Math.floor(t / 1000);
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
    const durSec = data.duration_minutes * 60;
    let cursor = startTs;
    let order = 0;
    while (cursor + durSec <= endTs && order < 500) {
      const id = generateId("slot");
      await db.insert(slots).values({
        id,
        event_id: data.event_id,
        slot_kind: "time",
        slot_label: null,
        start_time: cursor,
        end_time: cursor + durSec,
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
    const cnt = Math.max(1, data.count);
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
        end_time: null,
        sort_order: startIndex + i,
        status: "available",
        updated_at: now,
      });
      created.push({ id });
    }
  }

  await db.insert(historyLogs).values({
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
    created_at: now,
  });

  revalidatePath(`/admin/events/${data.event_id}/slots`);
  revalidatePath(`/admin/events/${data.event_id}`);
  revalidatePath(`/event/${data.event_id}`);
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

  await db.insert(historyLogs).values({
    table_name: "slots",
    record_id: eventId,
    action: "DELETE",
    after_data: JSON.stringify({ deleted: rows.length, scope: "available" }),
    operator_discord_id: guard.userId,
    retention_class: "normal",
    created_at: now,
  });

  revalidatePath(`/admin/events/${eventId}/slots`);
  revalidatePath(`/admin/events/${eventId}`);
  revalidatePath(`/event/${eventId}`);
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
  if (!row) return { ok: false, message: "スロットが見つかりません。" };

  const guard = await ensureCanEditSlots(row.event_id);
  if (!guard.ok) return guard.result;

  const now = Math.floor(Date.now() / 1000);
  await db
    .update(slots)
    .set({
      status: "available",
      discord_user_id: null,
      x_user_id: null,
      display_name: null,
      reservation_group_id: null,
      updated_at: now,
    })
    .where(eq(slots.id, slotId));

  await db.insert(historyLogs).values({
    table_name: "slots",
    record_id: slotId,
    action: "UPDATE",
    before_data: JSON.stringify({ status: row.status, x_user_id: row.x_user_id }),
    after_data: JSON.stringify({ status: "available", forced_release: true }),
    operator_discord_id: guard.userId,
    retention_class: "long_audit",
    created_at: now,
  });

  revalidatePath(`/admin/events/${row.event_id}/slots`);
  revalidatePath(`/admin/events/${row.event_id}`);
  revalidatePath(`/event/${row.event_id}`);
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
  if (!row) return { ok: false, message: "スロットが見つかりません。" };
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
  await db.insert(historyLogs).values({
    table_name: "slots",
    record_id: slotId,
    action: "DELETE",
    before_data: JSON.stringify({ event_id: row.event_id }),
    operator_discord_id: guard.userId,
    retention_class: "normal",
    created_at: now,
  });

  revalidatePath(`/admin/events/${row.event_id}/slots`);
  revalidatePath(`/admin/events/${row.event_id}`);
  revalidatePath(`/event/${row.event_id}`);
  return { ok: true };
}
