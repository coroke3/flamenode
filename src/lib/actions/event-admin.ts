"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  requireAdminWrite,
  writeGuard,
} from "@/lib/auth/writeGuard";
import {
  eventCustomQuestions,
  eventTemplates,
  events,
} from "@/lib/db/schema";
import {
  mutateWithAudit,
  planD1AuditMutationBudget,
} from "@/lib/audit/mutate";
import {
  parseEventTemplateSnapshot,
  type EventTemplateQuestionDefinition,
} from "@/lib/admin/eventTemplateSettings";
import { generateId } from "@/lib/utils/id";
import { buildStaticRebuildQueueBatch } from "@/lib/staticRebuild/enqueue";
import {
  buildPartsJson,
  parseEventForm,
  resolveSubmittedEventVisibility,
} from "@/lib/event/eventForm";
import { readCustomQuestionDefinitions } from "@/lib/event/customQuestionForm";
import { buildEventUpdatePayload, parseDateInput } from "@/lib/event/eventPayload";
import {
  hasAnyEventEditPermission,
  resolveEventEditPermissions,
} from "@/lib/event/eventEditPermissions";
import { MAX_EVENT_CUSTOM_QUESTIONS } from "@/lib/video/customQuestionLimits";

function revalidateEventPaths(eventId: string): void {
  revalidatePath("/admin/events");
  revalidatePath(`/admin/events/${eventId}`);
  revalidatePath("/manage");
  revalidatePath(`/manage/events/${eventId}`);
  revalidatePath(`/manage/events/${eventId}/edit`);
  revalidatePath("/event");
  revalidatePath(`/event/${eventId}`);
}

function revalidateEventListPaths(): void {
  revalidatePath("/admin/events");
  revalidatePath("/manage");
  revalidatePath("/event");
}

type PlannedQuestion = typeof eventCustomQuestions.$inferInsert;
type SelectedQuestion = typeof eventCustomQuestions.$inferSelect;

const MAX_QUESTIONS_PER_INSERT = 6;
const MAX_HISTORICAL_EVENT_QUESTIONS = 64;

function questionSnapshot(row: PlannedQuestion): Record<string, unknown> {
  return { ...row };
}

function fitsD1AtomicBatchBudget(
  mutationCount: number,
  auditCount: number,
  postAuditCount = 0,
): boolean {
  return planD1AuditMutationBudget({
    mutationStatementCount: mutationCount,
    mutationAssertionCount: mutationCount,
    auditEntryCount: auditCount,
    postAuditStatementCount: postAuditCount,
    distinctActorCount: 1,
  }).withinLimit;
}

function questionInsertChunks(rows: PlannedQuestion[]): PlannedQuestion[][] {
  const chunks: PlannedQuestion[][] = [];
  for (let index = 0; index < rows.length; index += MAX_QUESTIONS_PER_INSERT) {
    chunks.push(rows.slice(index, index + MAX_QUESTIONS_PER_INSERT));
  }
  return chunks;
}

function sameQuestionDefinition(
  current: SelectedQuestion,
  next: PlannedQuestion,
): boolean {
  return (
    current.question_key === next.question_key &&
    current.label === next.label &&
    current.description === next.description &&
    current.type === next.type &&
    current.required === next.required &&
    current.options_json === next.options_json &&
    current.placeholder === next.placeholder &&
    current.max_length === next.max_length &&
    current.sort_order === next.sort_order &&
    current.is_active === next.is_active &&
    current.visibility === next.visibility
  );
}

function templateQuestionDefinitions(
  definitions: readonly EventTemplateQuestionDefinition[],
) {
  return definitions
    .filter((definition) => definition.is_active)
    .slice(0, MAX_EVENT_CUSTOM_QUESTIONS)
    .map((definition, index) => ({
      ...definition,
      sort_order: index,
      is_active: true,
    }));
}

function buildQuestionRows(
  eventId: string,
  definitions: readonly {
    question_key: string;
    label: string;
    description: string | null;
    type: PlannedQuestion["type"];
    required: boolean;
    options_json: string | null;
    placeholder: string | null;
    max_length: number | null;
    sort_order: number;
    is_active: boolean;
    visibility: PlannedQuestion["visibility"];
  }[],
  now: number,
): PlannedQuestion[] {
  return definitions
    .filter((definition) => definition.is_active)
    .slice(0, MAX_EVENT_CUSTOM_QUESTIONS)
    .map((definition, index) => ({
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
      sort_order: index,
      is_active: 1,
      visibility: definition.visibility,
      created_at: now,
      updated_at: now,
    }));
}

export interface EventActionResult {
  ok: boolean;
  message?: string;
  eventId?: string;
}

export async function createEvent(
  formData: FormData,
): Promise<EventActionResult> {
  const guard = await requireAdminWrite("admin_event_create");
  if (!guard.ok) {
    return { ok: false, message: guard.message };
  }

  const actorUserId = guard.user.id;
  const { db } = guard;
  const parsed = parseEventForm(formData);
  if (!parsed.ok) return parsed;
  const data = parsed.data;
  const id = data.id?.trim() || generateId("ev");
  const now = Math.floor(Date.now() / 1000);

  let templateSnapshot = null;
  const templateId = data.template_id?.trim();
  if (templateId) {
    const template = (
      await db
        .select({ settings_json: eventTemplates.settings_json })
        .from(eventTemplates)
        .where(eq(eventTemplates.id, templateId))
        .limit(1)
    )[0];
    if (!template) {
      return { ok: false, message: "指定したテンプレートが見つかりません。" };
    }
    templateSnapshot = parseEventTemplateSnapshot(template.settings_json);
    if (!templateSnapshot) {
      return { ok: false, message: "テンプレートの設定データが不正です。" };
    }
  }

  const duplicate = (
    await db.select({ id: events.id }).from(events).where(eq(events.id, id)).limit(1)
  )[0];
  if (duplicate) return { ok: false, message: `ID「${id}」は既に存在します。` };

  const submittedQuestions = readCustomQuestionDefinitions(formData);
  if (!submittedQuestions.ok) return submittedQuestions;
  const definitions = submittedQuestions.submitted
    ? submittedQuestions.definitions
    : templateQuestionDefinitions(templateSnapshot?.custom_question_definitions ?? []);
  if (definitions.length > MAX_EVENT_CUSTOM_QUESTIONS) {
    return {
      ok: false,
      message: `カスタム質問は最大${MAX_EVENT_CUSTOM_QUESTIONS}件です。`,
    };
  }

  const visibilityStatus = resolveSubmittedEventVisibility(data);
  const createdRow = {
    id,
    title: data.title,
    event_type: data.event_type,
    explanation: data.explanation ?? null,
    icon_url: data.icon_url ?? null,
    img_url: data.img_url ?? null,
    accent_color: data.accent_color ?? null,
    visibility_status: visibilityStatus,
    allow_user_video_event_links: data.allow_user_video_event_links,
    allow_unslotted_posts: data.allow_unslotted_posts,
    allow_user_video_edits: data.allow_user_video_edits,
    user_video_edit_permission_keys_json:
      data.user_video_edit_permission_keys_json ?? null,
    start_time: parseDateInput(data.start_time),
    end_time: parseDateInput(data.end_time),
    entry_start_time: parseDateInput(data.entry_start_time),
    entry_end_time: parseDateInput(data.entry_end_time),
    max_slots_per_video: data.max_slots_per_video,
    slot_part_gap_minutes: data.slot_part_gap_minutes,
    slot_type: data.slot_type,
    slot_visibility_mode: data.slot_visibility_mode,
    parts_json: buildPartsJson(data.parts_text),
    review_settings: templateSnapshot?.review_settings ?? null,
    editable_fields: templateSnapshot?.editable_fields ?? null,
    repeat_rules: templateSnapshot?.repeat_rules ?? null,
    created_at: now,
    updated_at: now,
    public_api_enabled: 0,
  } satisfies typeof events.$inferInsert;
  const questions = buildQuestionRows(id, definitions, now);
  const insertChunks = questionInsertChunks(questions);

  const queue = await buildStaticRebuildQueueBatch(db, [
    { targetType: "event", targetId: id, reason: "event_create", priority: "high", requestedByUserId: actorUserId },
    { targetType: "events_index", targetId: "global", reason: "event_create", priority: "low", requestedByUserId: actorUserId },
    { targetType: "search_index", targetId: "global", reason: "event_create", priority: "low", requestedByUserId: actorUserId },
  ]);
  const mutationStatements = [
    db.insert(events).values(createdRow),
    ...insertChunks.map((chunk) => db.insert(eventCustomQuestions).values(chunk)),
    ...queue.statements,
  ];
  const expectedMutationChanges = [
    1,
    ...insertChunks.map((chunk) => chunk.length),
    ...queue.expectedChanges,
  ];
  const audits: Parameters<typeof mutateWithAudit>[1]["audits"] = [
    {
      table_name: "events",
      target_id: id,
      operation: "CREATE",
      before: null,
      after: createdRow,
      actor_user_id: actorUserId,
      retention_class: "normal",
      strict: true,
    },
    ...questions.map((row) => ({
      table_name: "event_custom_questions",
      target_id: row.id,
      operation: "CREATE" as const,
      before: null,
      after: questionSnapshot(row),
      actor_user_id: actorUserId,
      context: "event-create:custom-question",
      retention_class: "normal" as const,
      strict: true,
    })),
  ];
  if (!fitsD1AtomicBatchBudget(mutationStatements.length, audits.length)) {
    return { ok: false, message: "イベント作成の原子的処理がD1の上限を超えます。" };
  }
  await mutateWithAudit(db, {
    mutationStatements,
    expectedMutationChanges,
    audits,
  });

  revalidateEventListPaths();
  revalidateEventPaths(id);
  return { ok: true, eventId: id };
}

export async function updateEvent(
  formData: FormData,
): Promise<EventActionResult> {
  const guard = await writeGuard({ feature: "manage_event_update" });
  if (!guard.ok) {
    return { ok: false, message: guard.message };
  }

  const actorUserId = guard.user.id;
  const user = { id: guard.user.id, role: guard.user.role ?? null };
  const { db } = guard;
  const parsed = parseEventForm(formData);
  if (!parsed.ok) return parsed;
  const data = parsed.data;
  if (!data.id) return { ok: false, message: "id が必要です。" };

  const permissions = await resolveEventEditPermissions(db, user, data.id);
  if (!hasAnyEventEditPermission(permissions)) {
    return { ok: false, message: "このイベント設定を変更する権限がありません。" };
  }

  const before = (
    await db.select().from(events).where(eq(events.id, data.id)).limit(1)
  )[0];
  if (!before) return { ok: false, message: "イベントが見つかりません。" };

  const now = Math.floor(Date.now() / 1000);
  const built = buildEventUpdatePayload({
    data,
    before,
    permissions,
    now,
  });
  const after = { ...before, ...built.payload } as typeof events.$inferSelect;
  const mutations: Array<Parameters<typeof mutateWithAudit>[1]["mutationStatements"][number]> = [
    db.update(events)
      .set(built.payload)
      .where(and(eq(events.id, data.id), eq(events.updated_at, before.updated_at))),
  ];
  const expected = [1];
  const audits: Array<Parameters<typeof mutateWithAudit>[1]["audits"][number]> = [{
    table_name: "events",
    target_id: data.id,
    operation: "UPDATE",
    before,
    after,
    actor_user_id: actorUserId,
    retention_class: "normal",
    strict: true,
  }];

  if (permissions.questions) {
    const submittedQuestions = readCustomQuestionDefinitions(formData);
    if (!submittedQuestions.ok) return submittedQuestions;
    if (submittedQuestions.submitted) {
      const existing = await db
        .select()
        .from(eventCustomQuestions)
        .where(eq(eventCustomQuestions.event_id, data.id))
        .limit(MAX_HISTORICAL_EVENT_QUESTIONS + 1);
      if (existing.length > MAX_HISTORICAL_EVENT_QUESTIONS) {
        return {
          ok: false,
          message: "既存の質問履歴が多すぎるため、管理者による整理が必要です。",
        };
      }

      const definitions = submittedQuestions.definitions.filter((definition) => definition.is_active);
      if (definitions.length > MAX_EVENT_CUSTOM_QUESTIONS) {
        return {
          ok: false,
          message: `カスタム質問は最大${MAX_EVENT_CUSTOM_QUESTIONS}件です。`,
        };
      }
      const nextRows = buildQuestionRows(data.id, definitions, now);
      const existingByKey = new Map(existing.map((row) => [row.question_key, row]));
      const submittedKeys = new Set(nextRows.map((row) => row.question_key));

      for (const row of existing) {
        if (row.is_active !== 1 || submittedKeys.has(row.question_key)) continue;
        const next = { ...row, is_active: 0, updated_at: now };
        mutations.push(
          db.update(eventCustomQuestions)
            .set({ is_active: 0, updated_at: now })
            .where(and(
              eq(eventCustomQuestions.id, row.id),
              eq(eventCustomQuestions.updated_at, row.updated_at),
            )),
        );
        expected.push(1);
        audits.push({
          table_name: "event_custom_questions",
          target_id: row.id,
          operation: "UPDATE",
          before: row,
          after: next,
          actor_user_id: actorUserId,
          context: "event-update:disable-custom-question",
          retention_class: "normal",
          strict: true,
        });
      }

      const inserted: PlannedQuestion[] = [];
      for (const proposed of nextRows) {
        const current = existingByKey.get(proposed.question_key);
        if (!current) {
          inserted.push(proposed);
          continue;
        }
        const replacement: PlannedQuestion = {
          ...proposed,
          id: current.id,
          created_at: current.created_at,
        };
        if (sameQuestionDefinition(current, replacement)) continue;
        const {
          id: _id,
          event_id: _eventId,
          created_at: _createdAt,
          ...updateValues
        } = replacement;
        const updated = { ...current, ...replacement };
        mutations.push(
          db.update(eventCustomQuestions)
            .set(updateValues)
            .where(and(
              eq(eventCustomQuestions.id, current.id),
              eq(eventCustomQuestions.updated_at, current.updated_at),
            )),
        );
        expected.push(1);
        audits.push({
          table_name: "event_custom_questions",
          target_id: current.id,
          operation: "UPDATE",
          before: current,
          after: updated,
          actor_user_id: actorUserId,
          context: "event-update:custom-question",
          retention_class: "normal",
          strict: true,
        });
      }

      const insertChunks = questionInsertChunks(inserted);
      if (inserted.length > 0) {
        mutations.push(
          ...insertChunks.map((chunk) => db.insert(eventCustomQuestions).values(chunk)),
        );
        expected.push(...insertChunks.map((chunk) => chunk.length));
        audits.push(...inserted.map((row) => ({
          table_name: "event_custom_questions",
          target_id: row.id,
          operation: "CREATE" as const,
          before: null,
          after: row,
          actor_user_id: actorUserId,
          context: "event-update:custom-question",
          retention_class: "normal" as const,
          strict: true,
        })));
      }
    }
  }

  const queue = await buildStaticRebuildQueueBatch(db, [
    { targetType: "event", targetId: data.id, reason: "event_settings_update", requestedByUserId: actorUserId },
    { targetType: "events_index", targetId: "global", reason: "event_settings_update", priority: "low", requestedByUserId: actorUserId },
    { targetType: "search_index", targetId: "global", reason: "event_settings_update", priority: "low", requestedByUserId: actorUserId },
  ]);
  const mutationStatements = [...mutations, ...queue.statements];
  if (!fitsD1AtomicBatchBudget(mutationStatements.length, audits.length)) {
    return { ok: false, message: "イベント更新の原子的処理がD1の上限を超えます。" };
  }
  await mutateWithAudit(db, {
    mutationStatements,
    expectedMutationChanges: [...expected, ...queue.expectedChanges],
    audits,
  });

  revalidateEventPaths(data.id);
  return { ok: true, eventId: data.id };
}

export async function deleteEvent(
  formData: FormData,
): Promise<EventActionResult> {
  const guard = await requireAdminWrite("manage_event_archive");
  if (!guard.ok) {
    return { ok: false, message: guard.message };
  }

  const actorUserId = guard.user.id;
  const eventId = String(formData.get("event_id") ?? "").trim();
  const confirm = String(formData.get("confirm") ?? "").trim();
  if (!eventId) return { ok: false, message: "event_id が必要です。" };
  if (confirm !== eventId) {
    return {
      ok: false,
      message: "確認のため、イベント ID と同じ文字列を入力してください。",
    };
  }

  const { db } = guard;
  const now = Math.floor(Date.now() / 1000);
  const before = (
    await db.select().from(events).where(eq(events.id, eventId)).limit(1)
  )[0];
  if (!before) return { ok: false, message: "イベントが見つかりません。" };
  const after = { ...before, visibility_status: "private" as const, updated_at: now };
  const queue = await buildStaticRebuildQueueBatch(db, [
    { targetType: "event", targetId: eventId, reason: "event_private", priority: "high", requestedByUserId: actorUserId },
    { targetType: "events_index", targetId: "global", reason: "event_private", priority: "low", requestedByUserId: actorUserId },
    { targetType: "search_index", targetId: "global", reason: "event_private", priority: "low", requestedByUserId: actorUserId },
  ]);
  await mutateWithAudit(db, {
    mutationStatements: [
      db.update(events)
        .set({ visibility_status: "private", updated_at: now })
        .where(and(eq(events.id, eventId), eq(events.updated_at, before.updated_at))),
      ...queue.statements,
    ],
    expectedMutationChanges: [1, ...queue.expectedChanges],
    audits: [{
      table_name: "events",
      target_id: eventId,
      operation: "UPDATE",
      before,
      after,
      actor_user_id: actorUserId,
      retention_class: "long_audit",
      strict: true,
    }],
  });

  revalidateEventPaths(eventId);
  return { ok: true };
}
