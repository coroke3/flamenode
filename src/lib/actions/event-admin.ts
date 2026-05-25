"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import { assertCanEditEvent } from "@/lib/auth/ownership";
import { events, historyLogs } from "@/lib/db/schema";
import { parseJstDatetimeLocal } from "@/lib/utils/dateInput";
import { generateId } from "@/lib/utils/id";
import { normalizeHttpUrl } from "@/lib/utils/url";
import { DEFAULT_STAGE_PERMISSION_FIELD } from "@/lib/video/formSettings";

export interface EventActionResult {
  ok: boolean;
  message?: string;
  eventId?: string;
}

const eventSchema = z.object({
  id: z.string().trim().min(1).max(64).optional(),
  title: z.string().trim().min(1).max(200),
  event_type: z
    .enum(["event", "collabo", "type", "other"])
    .default("event"),
  explanation: z.string().trim().max(4000).optional().nullable(),
  icon_url: z.preprocess(
    (val) => (typeof val === "string" ? normalizeHttpUrl(val, { maxLength: 500 }) : val),
    z.string().trim().max(500).optional().nullable(),
  ),
  img_url: z.preprocess(
    (val) => (typeof val === "string" ? normalizeHttpUrl(val, { maxLength: 500 }) : val),
    z.string().trim().max(500).optional().nullable(),
  ),
  accent_color: z.string().trim().max(20).optional().nullable(),
  start_time: z.string().trim().optional().nullable(),
  end_time: z.string().trim().optional().nullable(),
  entry_start_time: z.string().trim().optional().nullable(),
  entry_end_time: z.string().trim().optional().nullable(),
  is_active: z.coerce.number().min(0).max(1).default(0),
  is_entry_open: z.coerce.number().min(0).max(1).default(0),
  is_archived: z.coerce.number().min(0).max(1).default(0),
  allow_user_video_event_links: z.coerce.number().min(0).max(1).default(0),
  allow_user_video_edits: z.coerce.number().min(0).max(1).default(0),
  user_video_edit_permission_keys_json: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .nullable(),
  stage_permission_enabled: z.coerce.number().min(0).max(1).default(0),
  stage_permission_required: z.coerce.number().min(0).max(1).default(0),
  stage_permission_label: z.string().trim().max(120).optional().nullable(),
  stage_permission_description: z.string().trim().max(1000).optional().nullable(),
  stage_permission_placeholder: z.string().trim().max(500).optional().nullable(),
  max_slots_per_video: z.coerce.number().min(1).max(20).default(1),
  max_consecutive_slots_per_entry: z.coerce.number().min(1).max(20).default(3),
  slot_part_gap_minutes: z.coerce.number().min(1).max(1440).default(30),
  slot_type: z.enum(["time", "count"]).default("time"),
  slot_visibility_mode: z
    .enum(["public_name", "anonymous", "hidden"])
    .default("public_name"),
});

function parseDateInput(raw: string | null | undefined): number | null {
  return parseJstDatetimeLocal(raw);
}

function buildVideoFormSettingsJson(data: z.infer<typeof eventSchema>): string {
  return JSON.stringify({
    stage_permission: {
      enabled: data.stage_permission_enabled === 1,
      required: data.stage_permission_required === 1,
      label:
        data.stage_permission_label?.trim() ||
        DEFAULT_STAGE_PERMISSION_FIELD.label,
      description:
        data.stage_permission_description?.trim() ||
        DEFAULT_STAGE_PERMISSION_FIELD.description,
      placeholder:
        data.stage_permission_placeholder?.trim() ||
        DEFAULT_STAGE_PERMISSION_FIELD.placeholder,
    },
  });
}

async function requireAdmin(): Promise<
  | { ok: true; userId: string }
  | { ok: false; result: EventActionResult }
> {
  const session = await auth().catch(() => null);
  const u = session?.user as { id?: string; role?: string } | undefined;
  if (!u?.id) return { ok: false, result: { ok: false, message: "ログインが必要です。" } };
  if (u.role !== "admin")
    return { ok: false, result: { ok: false, message: "管理者のみ操作できます。" } };
  return { ok: true, userId: u.id };
}

export async function createEvent(
  formData: FormData,
): Promise<EventActionResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const parsed = eventSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "入力エラー" };
  }
  const data = parsed.data;
  const id = data.id?.trim() || generateId("ev");
  const now = Math.floor(Date.now() / 1000);

  const dup = (
    await db.select({ id: events.id }).from(events).where(eq(events.id, id)).limit(1)
  )[0];
  if (dup) return { ok: false, message: `ID「${id}」は既に存在します。` };

  await db.insert(events).values({
    id,
    title: data.title,
    event_type: data.event_type,
    explanation: data.explanation ?? null,
    icon_url: data.icon_url ?? null,
    img_url: data.img_url ?? null,
    accent_color: data.accent_color ?? null,
    is_active: data.is_active,
    is_entry_open: data.is_entry_open,
    is_archived: data.is_archived,
    allow_user_video_event_links: data.allow_user_video_event_links,
    allow_user_video_edits: data.allow_user_video_edits,
    user_video_edit_permission_keys_json:
      data.user_video_edit_permission_keys_json ?? null,
    video_form_settings_json: buildVideoFormSettingsJson(data),
    start_time: parseDateInput(data.start_time),
    end_time: parseDateInput(data.end_time),
    entry_start_time: parseDateInput(data.entry_start_time),
    entry_end_time: parseDateInput(data.entry_end_time),
    max_slots_per_video: data.max_slots_per_video,
    max_consecutive_slots_per_entry: data.max_consecutive_slots_per_entry,
    slot_part_gap_minutes: data.slot_part_gap_minutes,
    slot_type: data.slot_type,
    slot_visibility_mode: data.slot_visibility_mode,
    created_at: now,
    updated_at: now,
  });

  await db.insert(historyLogs).values({
    table_name: "events",
    record_id: id,
    action: "CREATE",
    after_data: JSON.stringify({ title: data.title, is_active: data.is_active }),
    operator_discord_id: guard.userId,
    retention_class: "normal",
    created_at: now,
  });

  revalidatePath("/admin/events");
  revalidatePath("/event");
  revalidatePath(`/event/${id}`);
  return { ok: true, eventId: id };
}

export async function updateEvent(
  formData: FormData,
): Promise<EventActionResult> {
  const session = await auth().catch(() => null);
  const u = session?.user as { id?: string; role?: string } | undefined;
  if (!u?.id) return { ok: false, message: "ログインが必要です。" };

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const parsed = eventSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "入力エラー" };
  }
  const data = parsed.data;
  if (!data.id) return { ok: false, message: "id が必要です。" };

  try {
    await assertCanEditEvent(
      db,
      { id: u.id, role: u.role ?? null },
      data.id,
      "event.basic",
    );
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "権限がありません。",
    };
  }

  const now = Math.floor(Date.now() / 1000);
  await db
    .update(events)
    .set({
      title: data.title,
      event_type: data.event_type,
      explanation: data.explanation ?? null,
      icon_url: data.icon_url ?? null,
      img_url: data.img_url ?? null,
      accent_color: data.accent_color ?? null,
      is_active: data.is_active,
      is_entry_open: data.is_entry_open,
      is_archived: data.is_archived,
      allow_user_video_event_links: data.allow_user_video_event_links,
      allow_user_video_edits: data.allow_user_video_edits,
    user_video_edit_permission_keys_json:
      data.user_video_edit_permission_keys_json ?? null,
      video_form_settings_json: buildVideoFormSettingsJson(data),
      start_time: parseDateInput(data.start_time),
      end_time: parseDateInput(data.end_time),
      entry_start_time: parseDateInput(data.entry_start_time),
      entry_end_time: parseDateInput(data.entry_end_time),
      max_slots_per_video: data.max_slots_per_video,
      max_consecutive_slots_per_entry: data.max_consecutive_slots_per_entry,
      slot_part_gap_minutes: data.slot_part_gap_minutes,
      slot_type: data.slot_type,
      slot_visibility_mode: data.slot_visibility_mode,
      updated_at: now,
    })
    .where(eq(events.id, data.id));

  await db.insert(historyLogs).values({
    table_name: "events",
    record_id: data.id,
    action: "UPDATE",
    after_data: JSON.stringify({ title: data.title, is_active: data.is_active }),
    operator_discord_id: u.id,
    retention_class: "normal",
    created_at: now,
  });

  revalidatePath("/admin/events");
  revalidatePath(`/admin/events/${data.id}`);
  revalidatePath("/event");
  revalidatePath(`/event/${data.id}`);
  return { ok: true, eventId: data.id };
}

export async function deleteEvent(
  formData: FormData,
): Promise<EventActionResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;

  const eventId = String(formData.get("event_id") ?? "").trim();
  const confirm = String(formData.get("confirm") ?? "").trim();
  if (!eventId) return { ok: false, message: "event_id が必要です。" };
  if (confirm !== eventId) {
    return {
      ok: false,
      message: "確認のため、イベント ID と同じ文字列を入力してください。",
    };
  }

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const now = Math.floor(Date.now() / 1000);
  await db
    .update(events)
    .set({
      is_active: 0,
      is_entry_open: 0,
      is_archived: 1,
      updated_at: now,
    })
    .where(eq(events.id, eventId));

  await db.insert(historyLogs).values({
    table_name: "events",
    record_id: eventId,
    action: "UPDATE",
    after_data: JSON.stringify({ archived_by_delete_action: true }),
    operator_discord_id: guard.userId,
    retention_class: "long_audit",
    created_at: now,
  });

  revalidatePath("/admin/events");
  revalidatePath(`/admin/events/${eventId}`);
  revalidatePath("/event");
  revalidatePath(`/event/${eventId}`);
  return { ok: true };
}
