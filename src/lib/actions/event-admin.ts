"use server";

import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import {
  eventCustomQuestions,
  eventTemplates,
  events,
} from "@/lib/db/schema";
import { auditAction } from "@/lib/audit/helpers";
import {
  parseEventTemplateSnapshot,
  type EventTemplateQuestionDefinition,
} from "@/lib/admin/eventTemplateSettings";
import { generateId } from "@/lib/utils/id";
import { syncStagePermissionCustomQuestions } from "@/lib/video/stagePermissionQuestions";
import {
  buildPartsJson,
  buildVideoFormSettingsJson,
  parseEventForm,
  resolveSubmittedEventVisibility,
} from "@/lib/event/eventForm";
import { buildEventUpdatePayload, parseDateInput } from "@/lib/event/eventPayload";
import { writeEventUpdateAudit } from "@/lib/event/eventAudit";
import {
  revalidateEventListPaths,
  revalidateEventPaths,
} from "@/lib/event/eventRevalidate";
import {
  hasAnyEventEditPermission,
  resolveEventEditPermissions,
} from "@/lib/event/eventEditPermissions";

export interface EventActionResult {
  ok: boolean;
  message?: string;
  eventId?: string;
}

async function restoreTemplateCustomQuestions(
  db: NonNullable<ReturnType<typeof getDatabase>>,
  eventId: string,
  definitions: EventTemplateQuestionDefinition[],
  now: number,
): Promise<void> {
  if (definitions.length === 0) return;
  const values = definitions.map((definition) => ({
    id: generateId("ecq"),
    event_id: eventId,
    question_key: definition.question_key,
    label: definition.label,
    description: definition.description,
    type: definition.type,
    required: definition.required ? 1 : 0,
    options_json: definition.options_json,
    placeholder: definition.placeholder,
    max_length: definition.max_length,
    sort_order: definition.sort_order,
    is_active: definition.is_active ? 1 : 0,
    visibility: definition.visibility,
    created_at: now,
    updated_at: now,
  }));

  await db.insert(eventCustomQuestions).values(values).onConflictDoNothing();
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

  const parsed = parseEventForm(formData);
  if (!parsed.ok) return parsed;
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
  await db.insert(events).values({
    id,
    title: data.title,
    event_type: data.event_type,
    explanation: data.explanation ?? null,
    icon_url: data.icon_url ?? null,
    img_url: data.img_url ?? null,
    accent_color: data.accent_color ?? null,
    visibility_status: visibilityStatus,
    allow_user_video_event_links: data.allow_user_video_event_links,
    allow_user_video_edits: data.allow_user_video_edits,
    user_video_edit_permission_keys_json:
      data.user_video_edit_permission_keys_json ?? null,
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
    review_settings: templateSnapshot?.review_settings ?? null,
    editable_fields: templateSnapshot?.editable_fields ?? null,
    repeat_rules: templateSnapshot?.repeat_rules ?? null,
    created_at: now,
    updated_at: now,
  });

  await restoreTemplateCustomQuestions(
    db,
    id,
    templateSnapshot?.custom_question_definitions ?? [],
    now,
  );
  await syncStagePermissionCustomQuestions(db, id, videoFormSettingsJson, now);

  await auditAction(db, {
    table_name: "events",
    record_id: id,
    action: "CREATE",
    after_data: { title: data.title, visibility_status: visibilityStatus },
    operator_discord_id: guard.userId,
    retention_class: "normal",
  });

  revalidateEventListPaths();
  revalidateEventPaths(id);
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

  const parsed = parseEventForm(formData);
  if (!parsed.ok) return parsed;
  const data = parsed.data;
  if (!data.id) return { ok: false, message: "id が必要です。" };

  const user = { id: u.id, role: u.role ?? null };
  const permissions = await resolveEventEditPermissions(db, user, data.id);
  if (!hasAnyEventEditPermission(permissions)) {
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
  const built = buildEventUpdatePayload({
    data,
    before,
    formData,
    permissions,
    now,
  });

  await db
    .update(events)
    .set(built.payload)
    .where(eq(events.id, data.id));

  if (permissions.questions && built.videoFormSettingsJson != null) {
    await syncStagePermissionCustomQuestions(
      db,
      data.id,
      built.videoFormSettingsJson,
      now,
    );
  }

  await writeEventUpdateAudit({
    db,
    eventId: data.id,
    operatorUserId: u.id,
    updatedSections: built.updatedSections,
    changedByPermission: built.changedByPermission,
    before,
    afterPayload: built.payload,
  });

  revalidateEventPaths(data.id);

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
      visibility_status: "archived",
      updated_at: now,
    })
    .where(eq(events.id, eventId));

  await auditAction(db, {
    table_name: "events",
    record_id: eventId,
    action: "UPDATE",
    after_data: { archived_by_delete_action: true },
    operator_discord_id: guard.userId,
    retention_class: "long_audit",
  });

  revalidateEventPaths(eventId);
  return { ok: true };
}
