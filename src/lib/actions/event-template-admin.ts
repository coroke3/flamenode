"use server";

import { revalidatePath } from "next/cache";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { snapshotFromEvent } from "@/lib/admin/eventTemplateSettings";
import { eventCustomQuestions, eventTemplates, events } from "@/lib/db/schema";
import { requireAdminWrite } from "@/lib/auth/writeGuard";
import { expectedRowCondition } from "@/lib/audit/adapters";
import { mutateWithAudit } from "@/lib/audit/mutate";
import { loadStagePermissionFormSettingsJson } from "@/lib/video/stagePermissionQuestions";
import { generateId } from "@/lib/utils/id";

export interface EventTemplateActionResult {
  ok: boolean;
  message?: string;
  templateId?: string;
}

const saveSchema = z.object({
  event_id: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
});

export async function saveEventAsTemplate(
  formData: FormData,
): Promise<EventTemplateActionResult> {
  const guard = await requireAdminWrite("admin_event_templates");
  if (!guard.ok) return { ok: false, message: guard.message };

  const parsed = saveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "入力エラー",
    };
  }

  const { db } = guard;

  const event = (
    await db
      .select()
      .from(events)
      .where(eq(events.id, parsed.data.event_id))
      .limit(1)
  )[0];
  if (!event) {
    return { ok: false, message: "イベントが見つかりません。" };
  }

  const customQuestions = await db
    .select({
      question_key: eventCustomQuestions.question_key,
      label: eventCustomQuestions.label,
      description: eventCustomQuestions.description,
      type: eventCustomQuestions.type,
      required: eventCustomQuestions.required,
      options_json: eventCustomQuestions.options_json,
      placeholder: eventCustomQuestions.placeholder,
      max_length: eventCustomQuestions.max_length,
      sort_order: eventCustomQuestions.sort_order,
      is_active: eventCustomQuestions.is_active,
      visibility: eventCustomQuestions.visibility,
    })
    .from(eventCustomQuestions)
    .where(eq(eventCustomQuestions.event_id, event.id))
    .orderBy(
      asc(eventCustomQuestions.sort_order),
      asc(eventCustomQuestions.question_key),
    );

  const snapshot = snapshotFromEvent(
    event,
    customQuestions,
    await loadStagePermissionFormSettingsJson(db, event.id),
  );
  const id = generateId("etmpl");
  const now = Math.floor(Date.now() / 1000);

  const after: typeof eventTemplates.$inferSelect = {
    id,
    name: parsed.data.name,
    description: parsed.data.description?.trim() || null,
    source_event_id: event.id,
    settings_json: JSON.stringify(snapshot),
    created_by_user_id: guard.user.id,
    created_at: now,
    updated_at: now,
  };
  await mutateWithAudit(db, {
    mutationStatements: [db.insert(eventTemplates).values(after)],
    expectedMutationChanges: 1,
    audits: [{ table_name: "event_templates", target_id: id, operation: "CREATE", after: { ...after }, actor_user_id: guard.user.id, context: "admin_event_templates", reason: "イベントテンプレートを保存", retention_class: "normal", strict: true }],
  });

  revalidatePath("/admin/events/templates");
  revalidatePath(`/admin/events/${event.id}`);
  revalidatePath(`/manage/events/${event.id}`);
  return { ok: true, templateId: id, message: "テンプレートを保存しました。" };
}

export async function deleteEventTemplate(
  formData: FormData,
): Promise<EventTemplateActionResult> {
  const guard = await requireAdminWrite("admin_event_templates");
  if (!guard.ok) return { ok: false, message: guard.message };

  const templateId = String(formData.get("template_id") ?? "").trim();
  if (!templateId) {
    return { ok: false, message: "template_id が必要です。" };
  }

  const { db } = guard;

  const row = (
    await db
      .select()
      .from(eventTemplates)
      .where(eq(eventTemplates.id, templateId))
      .limit(1)
  )[0];
  if (!row) {
    return { ok: false, message: "テンプレートが見つかりません。" };
  }

  await mutateWithAudit(db, {
    mutationStatements: [db.delete(eventTemplates).where(and(eq(eventTemplates.id, templateId), expectedRowCondition({ expectedCurrent: { ...row } }))!)],
    expectedMutationChanges: 1,
    audits: [{ table_name: "event_templates", target_id: templateId, operation: "DELETE", before: { ...row }, actor_user_id: guard.user.id, context: "admin_event_templates", reason: "イベントテンプレートを削除", retention_class: "normal", strict: true }],
  });

  revalidatePath("/admin/events/templates");
  revalidatePath("/admin/events/new");
  return { ok: true, message: "テンプレートを削除しました。" };
}export async function listEventTemplatesForAdmin(): Promise<
  Array<{
    id: string;
    name: string;
    description: string | null;
    source_event_id: string | null;
    updated_at: number;
  }>
> {
  const guard = await requireAdminWrite("admin_event_templates");
  if (!guard.ok) return [];

  const { db } = guard;

  return db
    .select({
      id: eventTemplates.id,
      name: eventTemplates.name,
      description: eventTemplates.description,
      source_event_id: eventTemplates.source_event_id,
      updated_at: eventTemplates.updated_at,
    })
    .from(eventTemplates)
    .orderBy(desc(eventTemplates.updated_at));
}
