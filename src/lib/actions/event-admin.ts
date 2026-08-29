"use server";

import { and, eq, inArray, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireAdminWrite, writeGuard } from "@/lib/auth/writeGuard";
import {
  eventCustomQuestions,
  eventStaff,
  eventTemplates,
  events,
  publicVisibilityFences,
  videoCustomAnswers,
  xUserAccountLinks,
  xUsers,
} from "@/lib/db/schema";
import {
  mutateWithAudit,
  planD1AuditMutationBudget,
} from "@/lib/audit/mutate";
import {
  parseEventTemplateSnapshot,
  type EventTemplateSnapshot,
} from "@/lib/admin/eventTemplateSettings";
import { generateId } from "@/lib/utils/id";
import { resolveStagePermissionFieldsFromJson } from "@/lib/video/formSettings";
import { stagePermissionQuestionKeyCondition } from "@/lib/video/stagePermissionAnswers";
import { buildEventChangeQueueBatch } from "@/lib/staticRebuild/hooks";
import {
  compensateEventVisibilityFenceOnD1Failure,
  planEventVisibilityTransition,
  preCommitEventVisibilityTransition,
} from "@/lib/event/eventVisibilityTransition";
import {
  compensateEventIdReuseOnD1Failure,
  preCommitEventIdReuse,
  type EventIdReusePrecommit,
  type EventIdReuseTombstone,
} from "@/lib/event/eventIdReuse";
import { invalidateEventExportCache } from "@/lib/api/eventExportCache";
import { deletePublicJsonCaches } from "@/lib/publicData/publicCache";
import {
  eventBaseObjectKey,
  eventComposedObjectKey,
  eventSlotsObjectKey,
  eventReleaseObjectKey,
} from "@/lib/publicData/staticEventDetailCore";
import {
  buildPartsJson,
  buildVideoFormSettingsJson,
  EVENT_ID_PATTERN,
  parseEventForm,
  resolveSubmittedEventVisibility,
} from "@/lib/event/eventForm";
import { MAX_STAGE_PERMISSION_QUESTIONS } from "@/lib/event/eventLimits";
import { buildEventUpdatePayload, parseDateInput } from "@/lib/event/eventPayload";
import { serializeRequiredVideoFieldsFromForm } from "@/lib/video/requiredVideoFields";
import {
  hasAnyEventEditPermission,
  resolveEventEditPermissions,
} from "@/lib/event/eventEditPermissions";
import { markPendingPublicReflection } from "@/lib/staticRebuild/publicReflectionNotice";
import type { PendingPublicReflection } from "@/lib/staticRebuild/publicReflectionNotice";

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

const MAX_EVENT_CUSTOM_QUESTIONS = 18;
const MAX_EVENT_CUSTOM_ANSWER_DELETE_ROWS = 20;
const MAX_QUESTIONS_PER_INSERT = 6;

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
  current: typeof eventCustomQuestions.$inferSelect,
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

function stageQuestionRows(
  eventId: string,
  settingsJson: string,
  now: number,
): PlannedQuestion[] {
  return resolveStagePermissionFieldsFromJson([settingsJson]).map(
    (field, index): PlannedQuestion => ({
      id: generateId("ecq"),
      event_id: eventId,
      question_key: field.id,
      label: field.label,
      description: field.description || null,
      type: "textarea",
      required: field.required ? 1 : 0,
      options_json: null,
      placeholder: field.placeholder || null,
      max_length: 1000,
      sort_order: index,
      is_active: 1,
      visibility: "review",
      created_at: now,
      updated_at: now,
    }),
  );
}

export interface EventActionResult extends PendingPublicReflection {
  ok: boolean;
  message?: string;
  eventId?: string;
}

export async function createEvent(
  formData: FormData,
): Promise<EventActionResult> {
  const guard = await requireAdminWrite("admin_event_create");
  if (!guard.ok) return { ok: false, message: guard.message };

  const actorUserId = guard.user.id;
  const { db } = guard;
  const parsed = parseEventForm(formData);
  if (!parsed.ok) return parsed;
  const data = parsed.data;
  const id = data.id?.trim() || generateId("ev");
  if (!EVENT_ID_PATTERN.test(id)) {
    return {
      ok: false,
      message:
        "イベントIDは64文字以内で、英数字・_・-のみ使用できます。",
    };
  }
  const now = Math.floor(Date.now() / 1000);

  let templateSnapshot: EventTemplateSnapshot | null = null;
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

  const renameTombstone = (
    await db
      .select()
      .from(publicVisibilityFences)
      .where(
        and(
          eq(publicVisibilityFences.entity_type, "event"),
          eq(publicVisibilityFences.entity_id, id),
          eq(publicVisibilityFences.state, "blocked"),
          eq(publicVisibilityFences.reason, "event_id_rename_old_cleanup"),
        )!,
      )
      .limit(1)
  )[0];
  const activeXUserId = guard.user.active_x_user_id?.trim() || null;
  if (!activeXUserId) {
    return {
      ok: false,
      message: "イベント作成には承認済みの Active X ID が必要です。",
    };
  }
  const ownerIdentity = (
    await db
      .select({
        x_user_id: xUserAccountLinks.x_user_id,
        display_name: xUsers.x_name,
      })
      .from(xUserAccountLinks)
      .innerJoin(xUsers, eq(xUsers.id, xUserAccountLinks.x_user_id))
      .where(
        and(
          eq(xUserAccountLinks.auth_user_id, actorUserId),
          eq(xUserAccountLinks.x_user_id, activeXUserId),
          eq(xUsers.approval_status, "approved"),
        )!,
      )
      .limit(1)
  )[0];
  if (!ownerIdentity) {
    return {
      ok: false,
      message: "イベント作成には認証ユーザーへ紐付いた X 名義が必要です。",
    };
  }

  const videoFormSettingsJson = buildVideoFormSettingsJson(formData);
  const visibilityStatus = resolveSubmittedEventVisibility(data);
  const createdRow = {
    id,
    title: data.title,
    event_type: data.event_type,
    explanation: data.explanation ?? null,
    youtube_description_template: data.youtube_description_template ?? null,
    required_video_fields_json: (() => {
      const fromForm = serializeRequiredVideoFieldsFromForm(formData);
      return fromForm !== undefined
        ? fromForm
        : templateSnapshot?.required_video_fields_json ?? null;
    })(),
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
    max_slot_reservation_groups_per_xid:
      data.max_slot_reservation_groups_per_xid,
    slot_interval_minutes: data.slot_interval_minutes ?? null,
    slot_part_gap_minutes: data.slot_part_gap_minutes,
    slot_type: data.slot_type,
    slot_visibility_mode: data.slot_visibility_mode,
    parts_json: buildPartsJson(data.parts_text),
    review_settings: templateSnapshot?.review_settings ?? null,
    editable_fields: templateSnapshot?.editable_fields ?? null,
    repeat_rules: templateSnapshot?.repeat_rules ?? null,
    public_api_enabled: 0,
    created_at: now,
    updated_at: now,
  } satisfies typeof events.$inferInsert;
  const ownerRow = {
    id: generateId("es"),
    event_id: id,
    x_user_id: ownerIdentity.x_user_id,
    display_name: ownerIdentity.display_name,
    permission_preset: "owner" as const,
    custom_permission_keys_json: null,
    is_public: 1,
    public_role_label: "主催",
    approved_by_auth_user_id: actorUserId,
    approved_at: now,
    created_at: now,
    updated_at: now,
  } satisfies typeof eventStaff.$inferInsert;

  const templateQuestions: PlannedQuestion[] = (
    templateSnapshot?.custom_question_definitions ?? []
  ).map(
    (definition): PlannedQuestion => ({
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
    }),
  );
  const stageQuestions = stageQuestionRows(id, videoFormSettingsJson, now);
  if (stageQuestions.length > MAX_STAGE_PERMISSION_QUESTIONS) {
    return {
      ok: false,
      message: `ステージ・権利確認質問は最大${MAX_STAGE_PERMISSION_QUESTIONS}件です。`,
    };
  }
  const questions = [...templateQuestions, ...stageQuestions];
  if (questions.length > MAX_EVENT_CUSTOM_QUESTIONS) {
    return {
      ok: false,
      message: `カスタム質問はステージ質問を含めて最大${MAX_EVENT_CUSTOM_QUESTIONS}件です。`,
    };
  }
  if (new Set(questions.map((row) => row.question_key)).size !== questions.length) {
    return { ok: false, message: "カスタム質問の識別子が重複しています。" };
  }

  const questionChunks = questionInsertChunks(questions);
  const queue = await buildEventChangeQueueBatch(db, {
    eventId: id,
    reason: "event_create",
    requestedByUserId: actorUserId,
    priority: "high",
  });
  let reusePrecommit: EventIdReusePrecommit | null = null;
  if (renameTombstone) {
    const reuse = await preCommitEventIdReuse({
      db,
      eventId: id,
      tombstone: renameTombstone satisfies EventIdReuseTombstone,
      now,
    });
    if (!reuse.ok) {
      return {
        ok: false,
        message:
          "このイベントIDは旧URLの公開データ削除中です。削除完了後に再試行してください。",
      };
    }
    reusePrecommit = reuse.precommit;
  }
  const reuseFenceDelete = reusePrecommit
    ? db
        .delete(publicVisibilityFences)
        .where(
          and(
            eq(publicVisibilityFences.entity_type, "event"),
            eq(publicVisibilityFences.entity_id, id),
            eq(publicVisibilityFences.fence_token, reusePrecommit.fenceToken),
            eq(publicVisibilityFences.state, "blocked"),
            eq(
              publicVisibilityFences.reason,
              "event_id_rename_old_cleanup",
            ),
          )!,
        )
    : null;
  const mutationStatements = [
    ...(reuseFenceDelete ? [reuseFenceDelete] : []),
    db.insert(events).values(createdRow),
    db.insert(eventStaff).values(ownerRow),
    ...questionChunks.map((chunk) => db.insert(eventCustomQuestions).values(chunk)),
    ...queue.statements,
  ];
  const expectedMutationChanges = [
    ...(reuseFenceDelete ? [1] : []),
    1,
    1,
    ...questionChunks.map((chunk) => chunk.length),
    ...queue.expectedChanges,
  ];
  const audits: Parameters<typeof mutateWithAudit>[1]["audits"] = [
    ...(reusePrecommit
      ? [
          {
            table_name: "public_visibility_fences",
            target_id: id,
            operation: "DELETE" as const,
            before: renameTombstone,
            after: null,
            actor_user_id: actorUserId,
            context: "event-create:release-old-id-tombstone",
            reason: "event_id_rename_old_cleanup_complete",
            retention_class: "long_audit" as const,
            strict: true,
          },
        ]
      : []),
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
    {
      table_name: "event_staff",
      target_id: ownerRow.id,
      operation: "CREATE",
      before: null,
      after: ownerRow,
      actor_user_id: actorUserId,
      context: "event-create:owner",
      reason: "イベント作成者をownerとして登録",
      retention_class: "long_audit",
      restore_strategy: "delete_created",
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
    if (reusePrecommit) {
      await compensateEventIdReuseOnD1Failure(reusePrecommit);
    }
    return { ok: false, message: "イベント作成の原子的処理がD1の上限を超えます。" };
  }
  try {
    await mutateWithAudit(db, {
      mutationStatements,
      expectedMutationChanges,
      audits,
      staticRebuildWakeSource: queue.statements.length > 0 ? "admin" : undefined,
    });
  } catch (error) {
    if (reusePrecommit) {
      await compensateEventIdReuseOnD1Failure(reusePrecommit).catch(
        (compensationError) =>
          console.warn(
            "[event-admin] event ID reuse compensation failed",
            compensationError,
          ),
      );
    }
    throw error;
  }

  revalidateEventListPaths();
  revalidateEventPaths(id);
  return markPendingPublicReflection({ ok: true, eventId: id }, queue.statements.length > 0);
}

export async function updateEvent(
  formData: FormData,
): Promise<EventActionResult> {
  const guard = await writeGuard({ feature: "manage_event_update" });
  if (!guard.ok) return { ok: false, message: guard.message };

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

  // Compare against the revision rendered in the form. Re-reading the row
  // here must not turn a stale editor into a full overwrite of newer data.
  const submittedRevisionRaw = String(formData.get("revision") ?? "").trim();
  const submittedRevision = Number(submittedRevisionRaw);
  if (
    !submittedRevisionRaw ||
    !Number.isSafeInteger(submittedRevision) ||
    submittedRevision !== before.updated_at
  ) {
    return {
      ok: false,
      message:
        "このイベントは別の操作で更新されています。最新状態を確認してから再度保存してください。",
    };
  }

  const now = Math.max(
    Math.floor(Date.now() / 1000),
    before.updated_at + 1,
  );
  const built = buildEventUpdatePayload({
    data,
    before,
    formData,
    permissions,
    now,
  });
  const after = { ...before, ...built.payload } as typeof events.$inferSelect;
  const visibilityTransition = planEventVisibilityTransition({
    db,
    eventId: data.id,
    previousStatus: before.visibility_status,
    nextStatus: after.visibility_status,
    actorUserId,
    reason: "event_visibility_update",
    now,
  });
  const mutations: Array<
    Parameters<typeof mutateWithAudit>[1]["mutationStatements"][number]
  > = [
    db
      .update(events)
      .set(built.payload)
      .where(and(eq(events.id, data.id), eq(events.updated_at, before.updated_at))),
    ...visibilityTransition.mutationStatements,
  ];
  const expected = [1, ...visibilityTransition.expectedMutationChanges];
  const audits: Array<
    Parameters<typeof mutateWithAudit>[1]["audits"][number]
  > = [
    {
      table_name: "events",
      target_id: data.id,
      operation: "UPDATE",
      before,
      after,
      actor_user_id: actorUserId,
      retention_class: "normal",
      strict: true,
    },
  ];

  if (permissions.questions && built.videoFormSettingsJson != null) {
    const existing = await db
      .select()
      .from(eventCustomQuestions)
      .where(
        and(
          eq(eventCustomQuestions.event_id, data.id),
          stagePermissionQuestionKeyCondition(),
        ),
      )
      .limit(MAX_EVENT_CUSTOM_QUESTIONS + 1);
    if (existing.length > MAX_EVENT_CUSTOM_QUESTIONS) {
      return {
        ok: false,
        message: "既存のカスタム質問数が上限を超えているため更新できません。",
      };
    }
    const next = stageQuestionRows(data.id, built.videoFormSettingsJson, now);
    if (next.length > MAX_STAGE_PERMISSION_QUESTIONS) {
      return {
        ok: false,
        message: `ステージ・権利確認質問は最大${MAX_STAGE_PERMISSION_QUESTIONS}件です。`,
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
    const deletedAnswers =
      obsoleteQuestionIds.length > 0
        ? await db
            .select()
            .from(videoCustomAnswers)
            .where(inArray(videoCustomAnswers.question_id, obsoleteQuestionIds))
            .limit(MAX_EVENT_CUSTOM_ANSWER_DELETE_ROWS + 1)
        : [];
    if (deletedAnswers.length > MAX_EVENT_CUSTOM_ANSWER_DELETE_ROWS) {
      return {
        ok: false,
        message: "削除対象の回答数が上限を超えているため更新できません。",
      };
    }
    if (deletedAnswers.length > 0) {
      mutations.push(
        db.delete(videoCustomAnswers).where(
          or(
            ...deletedAnswers.map((answer) =>
              and(
                eq(videoCustomAnswers.video_id, answer.video_id),
                eq(videoCustomAnswers.event_id, answer.event_id),
                eq(videoCustomAnswers.question_id, answer.question_id),
                eq(videoCustomAnswers.updated_at, answer.updated_at),
              ),
            ),
          ),
        ),
      );
      expected.push(deletedAnswers.length);
      audits.push(
        ...deletedAnswers.map((answer) => ({
          table_name: "video_custom_answers",
          target_id: `${answer.video_id}:${answer.event_id}:${answer.question_id}`,
          operation: "DELETE" as const,
          before: answer,
          after: null,
          actor_user_id: actorUserId,
          context: "event-update:removed-stage-question-answer",
          retention_class: "normal" as const,
          strict: true,
        })),
      );
    }
    if (obsoleteQuestionIds.length > 0) {
      mutations.push(
        db.delete(eventCustomQuestions).where(
          or(
            ...obsoleteQuestions.map((row) =>
              and(
                eq(eventCustomQuestions.id, row.id),
                eq(eventCustomQuestions.updated_at, row.updated_at),
              ),
            ),
          ),
        ),
      );
      expected.push(obsoleteQuestionIds.length);
      audits.push(
        ...obsoleteQuestions.map((row) => ({
          table_name: "event_custom_questions",
          target_id: row.id,
          operation: "DELETE" as const,
          before: row,
          after: null,
          actor_user_id: actorUserId,
          context: "event-update:removed-stage-question",
          retention_class: "normal" as const,
          strict: true,
        })),
      );
    }

    for (const row of existing) {
      const replacement = nextByKey.get(row.question_key);
      if (!replacement) continue;
      nextByKey.delete(row.question_key);
      if (sameQuestionDefinition(row, replacement)) continue;
      const {
        id: _id,
        event_id: _eventId,
        created_at: _createdAt,
        ...updateValues
      } = replacement;
      const updated = {
        ...row,
        ...replacement,
        id: row.id,
        created_at: row.created_at,
      };
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
      audits.push({
        table_name: "event_custom_questions",
        target_id: row.id,
        operation: "UPDATE",
        before: row,
        after: updated,
        actor_user_id: actorUserId,
        context: "event-update:stage-question",
        retention_class: "normal",
        strict: true,
      });
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
      audits.push(
        ...insertedQuestions.map((row) => ({
          table_name: "event_custom_questions",
          target_id: row.id,
          operation: "CREATE" as const,
          before: null,
          after: row,
          actor_user_id: actorUserId,
          context: "event-update:stage-question",
          retention_class: "normal" as const,
          strict: true,
        })),
      );
    }
  }

  const queue = await buildEventChangeQueueBatch(db, {
    eventId: data.id,
    reason: visibilityTransition.fenceToken
      ? "event_visibility_update"
      : "event_settings_update",
    requestedByUserId: actorUserId,
    priority: visibilityTransition.fenceToken ? "high" : undefined,
  });
  const mutationStatements = [...mutations, ...queue.statements];
  if (!fitsD1AtomicBatchBudget(mutationStatements.length, audits.length)) {
    return { ok: false, message: "イベント更新の原子的処理がD1の上限を超えます。" };
  }
  if (visibilityTransition.fenceToken) {
    try {
      await preCommitEventVisibilityTransition({
        eventId: data.id,
        fenceToken: visibilityTransition.fenceToken,
        reason: "event_visibility_update",
      });
    } catch (error) {
      try {
        await compensateEventVisibilityFenceOnD1Failure(db, {
          eventId: data.id,
          fenceToken: visibilityTransition.fenceToken,
          allowNonPublicRollback: !visibilityTransition.depublicizedFromPublic,
        });
      } catch (compensationError) {
        console.warn("[event-admin] visibility precommit compensation failed", compensationError);
      }
      console.warn("[event-admin] visibility precommit failed", error);
      return { ok: false, message: "イベント公開状態の安全な反映準備に失敗しました。" };
    }
  }
  try {
    await mutateWithAudit(db, {
      mutationStatements,
      expectedMutationChanges: [...expected, ...queue.expectedChanges],
      audits,
      staticRebuildWakeSource: queue.statements.length > 0 ? "admin" : undefined,
    });
  } catch (error) {
    if (visibilityTransition.fenceToken) {
      try {
        await compensateEventVisibilityFenceOnD1Failure(db, {
          eventId: data.id,
          fenceToken: visibilityTransition.fenceToken,
          allowNonPublicRollback: !visibilityTransition.depublicizedFromPublic,
        });
      } catch (compensationError) {
        console.warn("[event-admin] visibility mutation compensation failed", compensationError);
      }
    }
    console.error("[event-admin] event mutation failed", error);
    return { ok: false, message: "イベント更新に失敗しました。状態を再取得してもう一度お試しください。" };
  }

  if (
    visibilityTransition.fenceToken ||
    built.updatedSections.includes("basic")
  ) {
    await deletePublicJsonCaches([
      eventComposedObjectKey(data.id),
      eventBaseObjectKey(data.id),
      eventSlotsObjectKey(data.id),
      eventReleaseObjectKey(data.id),
      "events/index.json",
      "list/recent.json",
      "list/popular.json",
      "top/sections/events.v1.json",
      "top.json",
    ]);
  }
  if (visibilityTransition.fenceToken || after.visibility_status !== "public") {
    await invalidateEventExportCache(data.id);
  }
  revalidateEventPaths(data.id);
  return markPendingPublicReflection(
    { ok: true, eventId: data.id },
    queue.statements.length > 0,
  );
}

export async function deleteEvent(
  formData: FormData,
): Promise<EventActionResult> {
  const guard = await requireAdminWrite("manage_event_archive");
  if (!guard.ok) return { ok: false, message: guard.message };

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
  const before = (
    await db.select().from(events).where(eq(events.id, eventId)).limit(1)
  )[0];
  const now = Math.max(
    Math.floor(Date.now() / 1000),
    before?.updated_at != null ? before.updated_at + 1 : 0,
  );
  if (!before) return { ok: false, message: "イベントが見つかりません。" };
  const after = {
    ...before,
    visibility_status: "private" as const,
    updated_at: now,
  };
  const visibilityTransition = planEventVisibilityTransition({
    db,
    eventId,
    previousStatus: before.visibility_status,
    nextStatus: after.visibility_status,
    actorUserId,
    reason: "event_private",
    now,
  });
  const queue = await buildEventChangeQueueBatch(db, {
    eventId,
    reason: "event_private",
    requestedByUserId: actorUserId,
    priority: "high",
  });
  const mutationStatements = [
    db
      .update(events)
      .set({ visibility_status: "private", updated_at: now })
      .where(and(eq(events.id, eventId), eq(events.updated_at, before.updated_at))),
    ...visibilityTransition.mutationStatements,
    ...queue.statements,
  ];
  if (!fitsD1AtomicBatchBudget(mutationStatements.length, 1)) {
    return { ok: false, message: "イベント非公開化の原子的処理がD1の上限を超えます。" };
  }
  if (visibilityTransition.fenceToken) {
    try {
      await preCommitEventVisibilityTransition({
        eventId,
        fenceToken: visibilityTransition.fenceToken,
        reason: "event_private",
      });
    } catch (error) {
      try {
        await compensateEventVisibilityFenceOnD1Failure(db, {
          eventId,
          fenceToken: visibilityTransition.fenceToken,
        });
      } catch (compensationError) {
        console.warn("[event-admin] visibility precommit compensation failed", compensationError);
      }
      console.warn("[event-admin] visibility precommit failed", error);
      return { ok: false, message: "イベント非公開化の安全な反映準備に失敗しました。" };
    }
  }
  try {
    await mutateWithAudit(db, {
      mutationStatements,
      expectedMutationChanges: [
        1,
        ...visibilityTransition.expectedMutationChanges,
        ...queue.expectedChanges,
      ],
      audits: [
        {
          table_name: "events",
          target_id: eventId,
          operation: "UPDATE",
          before,
          after,
          actor_user_id: actorUserId,
          retention_class: "long_audit",
          strict: true,
        },
      ],
      staticRebuildWakeSource: queue.statements.length > 0 ? "admin" : undefined,
    });
  } catch (error) {
    if (visibilityTransition.fenceToken) {
      try {
        await compensateEventVisibilityFenceOnD1Failure(db, {
          eventId,
          fenceToken: visibilityTransition.fenceToken,
        });
      } catch (compensationError) {
        console.warn("[event-admin] visibility mutation compensation failed", compensationError);
      }
    }
    console.error("[event-admin] event archive mutation failed", error);
    return { ok: false, message: "イベント非公開化に失敗しました。状態を再取得してもう一度お試しください。" };
  }

  await deletePublicJsonCaches([
    eventComposedObjectKey(eventId),
    eventBaseObjectKey(eventId),
    eventSlotsObjectKey(eventId),
    eventReleaseObjectKey(eventId),
    "events/index.json",
    "list/recent.json",
    "list/popular.json",
    "top/sections/events.v1.json",
    "top.json",
  ]);
  await invalidateEventExportCache(eventId);
  revalidateEventPaths(eventId);
  return markPendingPublicReflection({ ok: true }, queue.statements.length > 0);
}
