"use server";

import { and, eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import {
  eventCustomQuestions,
  eventTemplates,
  events,
} from "@/lib/db/schema";
import { mutateWithAudit } from "@/lib/audit/mutate";
import {
  parseEventTemplateSnapshot,
} from "@/lib/admin/eventTemplateSettings";
import { generateId } from "@/lib/utils/id";
import { resolveStagePermissionFieldsFromJson } from "@/lib/video/formSettings";
import { stagePermissionQuestionKeyCondition } from "@/lib/video/stagePermissionAnswers";
import { videoCustomAnswers } from "@/lib/db/schema";
import { buildStaticRebuildQueueBatch } from "@/lib/staticRebuild/enqueue";
import {
  buildPartsJson,
  buildVideoFormSettingsJson,
  parseEventForm,
  resolveSubmittedEventVisibility,
} from "@/lib/event/eventForm";
import { buildEventUpdatePayload, parseDateInput } from "@/lib/event/eventPayload";
import {
  revalidateEventListPaths,
  revalidateEventPaths,
} from "@/lib/event/eventRevalidate";
import {
  hasAnyEventEditPermission,
  resolveEventEditPermissions,
} from "@/lib/event/eventEditPermissions";

type PlannedQuestion = typeof eventCustomQuestions.$inferInsert;

export const MAX_EVENT_CUSTOM_QUESTIONS = 18;
export const MAX_D1_ATOMIC_BATCH_STATEMENTS = 50;
const MAX_QUESTIONS_PER_INSERT = 6;

function questionSnapshot(row: PlannedQuestion): Record<string, unknown> {
  return { ...row };
}

export function fitsD1AtomicBatchBudget(mutationCount: number): boolean {
  // mutateWithAudit は変更件数を検査するため、各 mutation の直後に assertion を
  // 1 statement 追加し、最後に audit INSERT と audit assertion を1件ずつ追加する。
  return mutationCount * 2 + 2 <= MAX_D1_ATOMIC_BATCH_STATEMENTS;
}

function questionInsertChunks(
  rows: PlannedQuestion[],
): PlannedQuestion[][] {
  const chunks: PlannedQuestion[][] = [];
  for (let index = 0; index < rows.length; index += MAX_QUESTIONS_PER_INSERT) {
    chunks.push(rows.slice(index, index + MAX_QUESTIONS_PER_INSERT));
  }
  return chunks;
}

function stageQuestionRows(
  eventId: string,
  settingsJson: string,
  now: number,
): PlannedQuestion[] {
  return resolveStagePermissionFieldsFromJson([settingsJson]).map((field, index) => ({
    id: generateId("ecq"), event_id: eventId, question_key: field.id,
    label: field.label, description: field.description || null, type: "textarea" as const,
    required: field.required ? 1 : 0, options_json: null, placeholder: field.placeholder || null,
    max_length: 1000, sort_order: index, is_active: 1, visibility: "review" as const,
    created_at: now, updated_at: now,
  }));
}

export interface EventActionResult {
  ok: boolean;
  message?: string;
  eventId?: string;
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
    representative_x_user_id: null,
    public_api_enabled: 0,
    public_api_updated_at: null,
  } satisfies typeof events.$inferInsert;
  const templateQuestions = (
    templateSnapshot?.custom_question_definitions ?? []
  ).map((definition) => ({
    id: generateId("ecq"),
    event_id: id,
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
  } satisfies PlannedQuestion));
  const questions = [...templateQuestions, ...stageQuestionRows(id, videoFormSettingsJson, now)];
  if (questions.length > MAX_EVENT_CUSTOM_QUESTIONS) {
    return {
      ok: false,
      message: `カスタム質問はステージ質問を含めて最大${MAX_EVENT_CUSTOM_QUESTIONS}件です。`,
    };
  }
  if (new Set(questions.map((row) => row.question_key)).size !== questions.length) {
    return { ok: false, message: "カスタム質問の識別子が重複しています。" };
  }
  const queue = await buildStaticRebuildQueueBatch(db, [
    { targetType: "event", targetId: id, reason: "event_create", priority: "high", requestedByUserId: guard.userId },
    { targetType: "events_index", targetId: "global", reason: "event_create", priority: "low", requestedByUserId: guard.userId },
    { targetType: "search_index", targetId: "global", reason: "event_create", priority: "low", requestedByUserId: guard.userId },
  ]);
  const mutationStatements = [
    db.insert(events).values(createdRow),
    ...questionInsertChunks(questions).map((chunk) =>
      db.insert(eventCustomQuestions).values(chunk),
    ),
    ...queue.statements,
  ];
  const expectedMutationChanges = [
    1,
    ...questionInsertChunks(questions).map((chunk) => chunk.length),
    ...queue.expectedChanges,
  ];
  if (!fitsD1AtomicBatchBudget(mutationStatements.length)) {
    return { ok: false, message: "イベント作成の原子的処理がD1の上限を超えます。" };
  }
  await mutateWithAudit(db, {
    mutationStatements,
    expectedMutationChanges,
    audits: [
      {
        table_name: "events",
        target_id: id,
        operation: "CREATE",
        before: null,
        after: createdRow,
        actor_user_id: guard.userId,
        retention_class: "normal",
        strict: true,
      },
      ...(questions.length > 0
        ? [{
            table_name: "event_custom_questions",
            target_id: id,
            operation: "CREATE" as const,
            before: null,
            after: { rows: questions.map(questionSnapshot) },
            actor_user_id: guard.userId,
            context: "event-create:custom-questions",
            retention_class: "normal" as const,
            strict: true,
          }]
        : []),
    ],
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

  const after = { ...before, ...built.payload } as typeof events.$inferSelect;
  const mutations: Array<Parameters<typeof mutateWithAudit>[1]["mutationStatements"][number]> = [db.update(events).set(built.payload).where(and(eq(events.id, data.id), eq(events.updated_at, before.updated_at)))];
  const expected = [1];
  const audits: Array<Parameters<typeof mutateWithAudit>[1]["audits"][number]> = [{
    table_name: "events", target_id: data.id, operation: "UPDATE" as const,
    before, after, actor_user_id: u.id, retention_class: "normal" as const, strict: true,
  }];

  if (permissions.questions && built.videoFormSettingsJson != null) {
    const existing = await db
      .select()
      .from(eventCustomQuestions)
      .where(
        and(
          eq(eventCustomQuestions.event_id, data.id),
          stagePermissionQuestionKeyCondition(),
        ),
      );
    const next = stageQuestionRows(data.id, built.videoFormSettingsJson, now);
    if (next.length > MAX_EVENT_CUSTOM_QUESTIONS) {
      return {
        ok: false,
        message: `カスタム質問は最大${MAX_EVENT_CUSTOM_QUESTIONS}件です。`,
      };
    }
    if (new Set(next.map((row) => row.question_key)).size !== next.length) {
      return { ok: false, message: "カスタム質問の識別子が重複しています。" };
    }
    const nextByKey = new Map(next.map((row) => [row.question_key, row]));
    const obsoleteQuestions = existing.filter(
      (row) => !nextByKey.has(row.question_key),
    );
    const obsoleteQuestionIds = obsoleteQuestions.map((row) => row.id);
    const deletedAnswers = obsoleteQuestionIds.length > 0
      ? await db
          .select()
          .from(videoCustomAnswers)
          .where(inArray(videoCustomAnswers.question_id, obsoleteQuestionIds))
      : [];
    if (deletedAnswers.length > 0) {
      mutations.push(
        db
          .delete(videoCustomAnswers)
          .where(inArray(videoCustomAnswers.question_id, obsoleteQuestionIds)),
      );
      expected.push(deletedAnswers.length);
      audits.push({
        table_name: "video_custom_answers",
        target_id: data.id,
        operation: "DELETE",
        before: { rows: deletedAnswers },
        after: { rows: [] },
        actor_user_id: u.id,
        context: "event-update:removed-stage-question-answers",
        retention_class: "normal",
        strict: true,
      });
    }
    if (obsoleteQuestionIds.length > 0) {
      mutations.push(
        db
          .delete(eventCustomQuestions)
          .where(inArray(eventCustomQuestions.id, obsoleteQuestionIds)),
      );
      expected.push(obsoleteQuestionIds.length);
    }

    const finalQuestions: Array<typeof eventCustomQuestions.$inferSelect> = [];
    for (const row of existing) {
      const replacement = nextByKey.get(row.question_key);
      if (!replacement) {
        continue;
      }
      nextByKey.delete(row.question_key);
      const { id: _id, event_id: _eventId, created_at: _createdAt, ...updateValues } = replacement;
      const updated = { ...row, ...replacement, id: row.id, created_at: row.created_at };
      mutations.push(
        db
          .update(eventCustomQuestions)
          .set(updateValues)
          .where(
            and(
              eq(eventCustomQuestions.id, row.id),
              eq(eventCustomQuestions.updated_at, row.updated_at),
            ),
          ),
      );
      expected.push(1);
      finalQuestions.push(updated);
    }
    const insertedQuestions = [...nextByKey.values()];
    if (insertedQuestions.length > 0) {
      const insertChunks = questionInsertChunks(insertedQuestions);
      mutations.push(
        ...insertChunks.map((chunk) =>
          db.insert(eventCustomQuestions).values(chunk),
        ),
      );
      expected.push(...insertChunks.map((chunk) => chunk.length));
      finalQuestions.push(
        ...insertedQuestions as Array<typeof eventCustomQuestions.$inferSelect>,
      );
    }
    const questionsChanged =
      existing.length > 0 || insertedQuestions.length > 0;
    if (questionsChanged) {
      audits.push({
        table_name: "event_custom_questions",
        target_id: data.id,
        operation: "UPDATE",
        before: { rows: existing },
        after: { rows: finalQuestions },
        actor_user_id: u.id,
        context: "event-update:stage-questions",
        retention_class: "normal",
        strict: true,
      });
    }
  }
  const queue = await buildStaticRebuildQueueBatch(db, [
    { targetType: "event", targetId: data.id, reason: "event_settings_update", requestedByUserId: u.id },
    { targetType: "events_index", targetId: "global", reason: "event_settings_update", priority: "low", requestedByUserId: u.id },
    { targetType: "search_index", targetId: "global", reason: "event_settings_update", priority: "low", requestedByUserId: u.id },
  ]);
  const mutationStatements = [...mutations, ...queue.statements];
  if (!fitsD1AtomicBatchBudget(mutationStatements.length)) {
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
  const before = (await db.select().from(events).where(eq(events.id, eventId)).limit(1))[0];
  if (!before) return { ok: false, message: "イベントが見つかりません。" };
  const after = { ...before, visibility_status: "archived" as const, updated_at: now };
  const queue = await buildStaticRebuildQueueBatch(db, [
    { targetType: "event", targetId: eventId, reason: "event_archive", priority: "high", requestedByUserId: guard.userId },
    { targetType: "events_index", targetId: "global", reason: "event_archive", priority: "low", requestedByUserId: guard.userId },
    { targetType: "search_index", targetId: "global", reason: "event_archive", priority: "low", requestedByUserId: guard.userId },
  ]);
  await mutateWithAudit(db, {
    mutationStatements: [db.update(events).set({ visibility_status: "archived", updated_at: now }).where(and(eq(events.id, eventId), eq(events.updated_at, before.updated_at))), ...queue.statements],
    expectedMutationChanges: [1, ...queue.expectedChanges],
    audits: [{ table_name: "events", target_id: eventId, operation: "UPDATE", before, after, actor_user_id: guard.userId, retention_class: "long_audit", strict: true }],
  });

  revalidateEventPaths(eventId);
  return { ok: true };
}
