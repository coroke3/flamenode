"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import { canEditEvent } from "@/lib/auth/ownership";
import {
  eventTemplates,
  events,
  historyLogs,
} from "@/lib/db/schema";
import { parseEventTemplateSnapshot } from "@/lib/admin/eventTemplateSettings";
import { parseJstDatetimeLocal } from "@/lib/utils/dateInput";
import { generateId } from "@/lib/utils/id";
import { normalizeHttpUrl } from "@/lib/utils/url";
import {
  DEFAULT_STAGE_PERMISSION_FIELD,
} from "@/lib/video/formSettings";
import { syncStagePermissionCustomQuestions } from "@/lib/video/stagePermissionQuestions";
import {
  syncLegacyEventVisibilityFlags,
  type EventVisibilityStatus,
} from "@/lib/utils/eventStatus";

export interface EventActionResult {
  ok: boolean;
  message?: string;
  eventId?: string;
}

type EventUpdatePayload = Partial<typeof events.$inferInsert>;
type EventEditSection = "basic" | "publish" | "questions" | "slots";

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
  visibility_status: z
    .enum(["draft", "private", "public", "archived"])
    .optional(),
  is_active: z.coerce.number().min(0).max(1).default(0),
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
  slot_part_gap_minutes: z.coerce.number().min(1).max(1440).default(15),
  slot_type: z.enum(["time", "count"]).default("time"),
  slot_visibility_mode: z
    .enum(["public_name", "anonymous", "hidden"])
    .default("public_name"),
  parts_text: z.string().max(2000).optional().nullable(),
  template_id: z.string().trim().max(64).optional().nullable(),
});

const PART_NAME_MAX_LEN = 40;
const PART_MAX_COUNT = 20;

function buildPartsJson(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const truncated = trimmed.slice(0, PART_NAME_MAX_LEN);
    if (seen.has(truncated)) continue;
    seen.add(truncated);
    parts.push(truncated);
    if (parts.length >= PART_MAX_COUNT) break;
  }
  if (parts.length === 0) return null;
  return JSON.stringify(parts);
}

function parseDateInput(raw: string | null | undefined): number | null {
  return parseJstDatetimeLocal(raw);
}

function resolveSubmittedEventVisibility(
  data: Pick<z.infer<typeof eventSchema>, "visibility_status" | "is_active" | "is_archived">,
): EventVisibilityStatus {
  if (data.visibility_status) return data.visibility_status;
  if (data.is_archived === 1) return "archived";
  if (data.is_active === 1) return "public";
  return "draft";
}

function boolFormValue(value: FormDataEntryValue | undefined): boolean {
  return String(value ?? "") === "1";
}

function cleanQuestionId(value: FormDataEntryValue | undefined, index: number): string {
  const fallback =
    index === 0 ? "stage_permission" : `stage_permission_${index + 1}`;
  const cleaned = String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .slice(0, 64);
  return cleaned || fallback;
}

function buildVideoFormSettingsJson(
  formData: FormData,
  data: z.infer<typeof eventSchema>,
): string {
  const ids = formData.getAll("stage_permission_question_id");
  const enabled = formData.getAll("stage_permission_question_enabled");
  const required = formData.getAll("stage_permission_question_required");
  const labels = formData.getAll("stage_permission_question_label");
  const descriptions = formData.getAll("stage_permission_question_description");
  const placeholders = formData.getAll("stage_permission_question_placeholder");
  const sentQuestionArray =
    String(formData.get("stage_permission_questions_present") ?? "") === "1";

  if (sentQuestionArray || ids.length > 0) {
    const stagePermissions = ids.slice(0, 20).map((id, index) => ({
      id: cleanQuestionId(id, index),
      enabled: boolFormValue(enabled[index]),
      required: boolFormValue(required[index]),
      label:
        String(labels[index] ?? "").trim().slice(0, 120) ||
        DEFAULT_STAGE_PERMISSION_FIELD.label,
      description:
        String(descriptions[index] ?? "").trim().slice(0, 1000) ||
        DEFAULT_STAGE_PERMISSION_FIELD.description,
      placeholder:
        String(placeholders[index] ?? "").trim().slice(0, 500) ||
        DEFAULT_STAGE_PERMISSION_FIELD.placeholder,
    }));
    return JSON.stringify({ stage_permissions: stagePermissions });
  }

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

  let templateSnapshot = null;
  const templateId = data.template_id?.trim();
  if (templateId) {
    const tmpl = (
      await db
        .select({ settings_json: eventTemplates.settings_json })
        .from(eventTemplates)
        .where(eq(eventTemplates.id, templateId))
        .limit(1)
    )[0];
    if (!tmpl) {
      return { ok: false, message: "指定したテンプレートが見つかりません。" };
    }
    templateSnapshot = parseEventTemplateSnapshot(tmpl.settings_json);
    if (!templateSnapshot) {
      return { ok: false, message: "テンプレートの設定データが不正です。" };
    }
  }

  const dup = (
    await db.select({ id: events.id }).from(events).where(eq(events.id, id)).limit(1)
  )[0];
  if (dup) return { ok: false, message: `ID「${id}」は既に存在します。` };

  const videoFormSettingsJson = buildVideoFormSettingsJson(formData, data);
  const visibilityStatus = resolveSubmittedEventVisibility(data);
  const legacyVisibility = syncLegacyEventVisibilityFlags(visibilityStatus);
  await db.insert(events).values({
    id,
    title: data.title,
    event_type: data.event_type,
    explanation: data.explanation ?? null,
    icon_url: data.icon_url ?? null,
    img_url: data.img_url ?? null,
    accent_color: data.accent_color ?? null,
    visibility_status: visibilityStatus,
    is_active: legacyVisibility.is_active,
    is_entry_open: legacyVisibility.is_entry_open,
    is_archived: legacyVisibility.is_archived,
    allow_user_video_event_links: data.allow_user_video_event_links,
    allow_user_video_edits: data.allow_user_video_edits,
    user_video_edit_permission_keys_json:
      data.user_video_edit_permission_keys_json ?? null,
    video_form_settings_json: videoFormSettingsJson,
    start_time: parseDateInput(data.start_time),
    end_time: parseDateInput(data.end_time),
    entry_start_time: parseDateInput(data.entry_start_time),
    entry_end_time: parseDateInput(data.entry_end_time),
    max_slots_per_video: data.max_slots_per_video,
    max_consecutive_slots_per_entry: data.max_consecutive_slots_per_entry,
    slot_part_gap_minutes: data.slot_part_gap_minutes,
    slot_type: data.slot_type,
    slot_visibility_mode: data.slot_visibility_mode,
    parts_json: buildPartsJson(data.parts_text),
    custom_questions: templateSnapshot?.custom_questions ?? null,
    review_settings: templateSnapshot?.review_settings ?? null,
    editable_fields: templateSnapshot?.editable_fields ?? null,
    repeat_rules: templateSnapshot?.repeat_rules ?? null,
    created_at: now,
    updated_at: now,
  });

  await syncStagePermissionCustomQuestions(db, id, videoFormSettingsJson, now);

  await db.insert(historyLogs).values({
    table_name: "events",
    record_id: id,
    action: "CREATE",
    after_data: JSON.stringify({ title: data.title, visibility_status: visibilityStatus }),
    operator_discord_id: guard.userId,
    retention_class: "normal",
    created_at: now,
  });

  revalidatePath("/admin/events");
  revalidatePath("/manage");
  revalidatePath(`/manage/events/${id}`);
  revalidatePath(`/manage/events/${id}/edit`);
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

  const user = { id: u.id, role: u.role ?? null };
  const [canBasic, canPublish, canQuestions, canSlots] = await Promise.all([
    canEditEvent(db, user, data.id, "event.basic"),
    canEditEvent(db, user, data.id, "event.publish"),
    canEditEvent(db, user, data.id, "event.questions"),
    canEditEvent(db, user, data.id, "event.slots"),
  ]);
  if (!canBasic && !canPublish && !canQuestions && !canSlots) {
    return {
      ok: false,
      message: "このイベント設定を変更する権限がありません。",
    };
  }

  const before = (
    await db.select().from(events).where(eq(events.id, data.id)).limit(1)
  )[0];
  if (!before) return { ok: false, message: "イベントが見つかりません。" };

  const now = Math.floor(Date.now() / 1000);
  const updatePayload: EventUpdatePayload = { updated_at: now };
  const updatedSections: EventEditSection[] = [];
  const changedByPermission: Record<EventEditSection, string> = {} as Record<
    EventEditSection,
    string
  >;

  if (canBasic) {
    Object.assign(updatePayload, {
      title: data.title,
      event_type: data.event_type,
      explanation: data.explanation ?? null,
      icon_url: data.icon_url ?? null,
      img_url: data.img_url ?? null,
      accent_color: data.accent_color ?? null,
      start_time: parseDateInput(data.start_time),
      end_time: parseDateInput(data.end_time),
    });
    updatedSections.push("basic");
    changedByPermission.basic = "event.basic";
  }

  if (canPublish) {
    const visibilityStatus = resolveSubmittedEventVisibility(data);
    const legacyVisibility = syncLegacyEventVisibilityFlags(visibilityStatus);
    Object.assign(updatePayload, {
      visibility_status: visibilityStatus,
      is_active: legacyVisibility.is_active,
      is_entry_open: legacyVisibility.is_entry_open,
      is_archived: legacyVisibility.is_archived,
      entry_start_time: parseDateInput(data.entry_start_time),
      entry_end_time: parseDateInput(data.entry_end_time),
      allow_user_video_event_links: data.allow_user_video_event_links,
    });
    updatedSections.push("publish");
    changedByPermission.publish = "event.publish";
  }

  let videoFormSettingsJson: string | null = null;
  if (canQuestions) {
    videoFormSettingsJson = buildVideoFormSettingsJson(formData, data);
    Object.assign(updatePayload, {
      allow_user_video_edits: data.allow_user_video_edits,
      user_video_edit_permission_keys_json:
        data.user_video_edit_permission_keys_json ?? null,
      video_form_settings_json: videoFormSettingsJson,
    });
    updatedSections.push("questions");
    changedByPermission.questions = "event.questions";
  }

  if (canSlots) {
    Object.assign(updatePayload, {
      max_slots_per_video: data.max_slots_per_video,
      max_consecutive_slots_per_entry: data.max_consecutive_slots_per_entry,
      slot_part_gap_minutes: data.slot_part_gap_minutes,
      slot_type: data.slot_type,
      slot_visibility_mode: data.slot_visibility_mode,
      parts_json: buildPartsJson(data.parts_text),
    });
    updatedSections.push("slots");
    changedByPermission.slots = "event.slots";
  }

  await db
    .update(events)
    .set(updatePayload)
    .where(eq(events.id, data.id));

  if (canQuestions && videoFormSettingsJson != null) {
    await syncStagePermissionCustomQuestions(db, data.id, videoFormSettingsJson, now);
  }

  await db.insert(historyLogs).values({
    table_name: "events",
    record_id: data.id,
    action: "UPDATE",
    before_data: JSON.stringify({
      updated_sections: updatedSections,
      basic: canBasic
        ? {
            title: before.title,
            event_type: before.event_type,
            start_time: before.start_time,
            end_time: before.end_time,
          }
        : undefined,
      publish: canPublish
        ? {
            visibility_status: before.visibility_status,
            is_active: before.is_active,
            is_archived: before.is_archived,
            entry_start_time: before.entry_start_time,
            entry_end_time: before.entry_end_time,
            allow_user_video_event_links: before.allow_user_video_event_links,
          }
        : undefined,
    }),
    after_data: JSON.stringify({
      updated_sections: updatedSections,
      changed_by_permission: changedByPermission,
      update: updatePayload,
    }),
    operator_discord_id: u.id,
    retention_class: "normal",
    created_at: now,
  });

  revalidatePath("/admin/events");
  revalidatePath(`/admin/events/${data.id}`);
  revalidatePath("/manage");
  revalidatePath(`/manage/events/${data.id}`);
  revalidatePath(`/manage/events/${data.id}/edit`);
  revalidatePath("/event");
  revalidatePath(`/event/${data.id}`);

  const { enqueueAfterEventSettingsChange } = await import(
    "@/lib/staticRebuild/hooks"
  );
  await enqueueAfterEventSettingsChange(db, {
    db,
    eventId: data.id,
    reason: "event_settings_update",
    requestedByUserId: u.id,
  });

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
      visibility_status: "archived",
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
  revalidatePath("/manage");
  revalidatePath(`/manage/events/${eventId}`);
  revalidatePath(`/manage/events/${eventId}/edit`);
  revalidatePath("/event");
  revalidatePath(`/event/${eventId}`);
  return { ok: true };
}
