/** CURRENT event update composition, shared without changing section or form semantics. */
import { eventCustomQuestions, videoCustomAnswers, type events } from "@flamenode/db/schema";
import { and, eq, or } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { ServerCoreDb } from "../db.ts";
import type { WriteAuditLogInput } from "../audit/types.ts";
import { planAtomicAuditMutationBudget, type AtomicAuditMutationInput } from "../audit/mutate.ts";
import { MAX_STAGE_PERMISSION_QUESTIONS } from "@flamenode/domain/event/limits";
import {
  buildVideoFormSettingsJson,
  resolveSubmittedEventVisibility,
  type EventFormData,
} from "@flamenode/domain/event/form";
import { serializeRequiredVideoFieldsFromForm } from "@flamenode/domain/video";
import {
  buildBasicEventUpdateFields,
  buildPublishEventUpdateFields,
  buildQuestionsEventUpdateFields,
  buildSlotsEventUpdateFields,
  type EventEditPermissions,
} from "@flamenode/domain/event";

export type EventEditSection = "basic" | "publish" | "questions" | "slots";

export const EVENT_SECTION_PERMISSION_KEYS = {
  basic: "event.basic",
  publish: "event.publish",
  questions: "event.questions",
  slots: "event.slots",
} as const satisfies Record<EventEditSection, string>;

export type EventUpdatePayload = Partial<typeof events.$inferInsert>;

export function buildEventUpdatePayload(args: {
  data: EventFormData;
  before: typeof events.$inferSelect;
  formData: FormData;
  permissions: EventEditPermissions;
  now: number;
}): {
  payload: EventUpdatePayload;
  updatedSections: EventEditSection[];
  changedByPermission: Record<EventEditSection, string>;
  videoFormSettingsJson: string | null;
} {
  const { data, before, formData, permissions, now } = args;
  const updatePayload: EventUpdatePayload = { updated_at: now };
  const updatedSections: EventEditSection[] = [];
  const changedByPermission = {} as Record<EventEditSection, string>;
  let videoFormSettingsJson: string | null = null;

  if (permissions.basic) {
    Object.assign(updatePayload, buildBasicEventUpdateFields({
      data,
      previousYoutubeDescriptionTemplate: before.youtube_description_template,
      hasYoutubeDescriptionTemplateField: formData.has("youtube_description_template"),
    }));
    updatedSections.push("basic");
    changedByPermission.basic = EVENT_SECTION_PERMISSION_KEYS.basic;
  }

  if (permissions.publish) {
    const visibilityStatus = resolveSubmittedEventVisibility(data);
    Object.assign(updatePayload, buildPublishEventUpdateFields({
      data,
      visibilityStatus,
    }));
    updatedSections.push("publish");
    changedByPermission.publish = EVENT_SECTION_PERMISSION_KEYS.publish;
  }

  if (permissions.questions) {
    videoFormSettingsJson = buildVideoFormSettingsJson(formData);
    const requiredVideoFieldsJson = serializeRequiredVideoFieldsFromForm(formData);
    Object.assign(updatePayload, buildQuestionsEventUpdateFields({
      data,
      requiredVideoFieldsJson,
      previousRequiredVideoFieldsJson: before.required_video_fields_json,
      previousEditableFields: before.editable_fields,
      previousReviewSettings: before.review_settings,
    }));
    updatedSections.push("questions");
    changedByPermission.questions = EVENT_SECTION_PERMISSION_KEYS.questions;
  }

  if (permissions.slots) {
    Object.assign(updatePayload, buildSlotsEventUpdateFields(data));
    updatedSections.push("slots");
    changedByPermission.slots = EVENT_SECTION_PERMISSION_KEYS.slots;
  }

  return {
    payload: updatePayload,
    updatedSections,
    changedByPermission,
    videoFormSettingsJson,
  };
}

/** SA-023 U03f: side-effect-free stage-question diff, before any D1/strict-audit plan.
 * The caller retains responsibility for caps, revision CAS and atomic writes. */
export interface StageQuestionDefinition {
  question_key: string;
  label: string;
  description: string | null;
  type: string;
  required: number;
  options_json: string | null;
  placeholder: string | null;
  max_length: number | null;
  sort_order: number;
  is_active: number;
  visibility: string;
}

const stageQuestionComparedKeys = [
  "question_key", "label", "description", "type", "required",
  "options_json", "placeholder", "max_length", "sort_order",
  "is_active", "visibility",
] as const;

export type StageQuestionDiff<Old extends StageQuestionDefinition, New extends StageQuestionDefinition> =
  | { ok: false; reason: "duplicate_existing_key" | "duplicate_next_key" }
  | {
      ok: true;
      obsolete: Old[];
      changed: Array<{ before: Old; replacement: New }>;
      inserted: New[];
    };

/** Preserve CURRENT's existing-order deletion/update and next-order insertion.
 * Reject duplicate keys rather than silently overwriting a Map entry. */
export function planStageQuestionDiff<Old extends StageQuestionDefinition, New extends StageQuestionDefinition>(
  existing: readonly Old[],
  next: readonly New[],
): StageQuestionDiff<Old, New> {
  const nextByKey = new Map<string, New>();
  for (const row of next) {
    if (nextByKey.has(row.question_key)) return { ok: false, reason: "duplicate_next_key" };
    nextByKey.set(row.question_key, row);
  }
  const existingKeys = new Set<string>();
  const obsolete: Old[] = [];
  const changed: Array<{ before: Old; replacement: New }> = [];
  for (const row of existing) {
    if (existingKeys.has(row.question_key)) return { ok: false, reason: "duplicate_existing_key" };
    existingKeys.add(row.question_key);
    const replacement = nextByKey.get(row.question_key);
    if (!replacement) {
      obsolete.push(row);
      continue;
    }
    nextByKey.delete(row.question_key);
    if (stageQuestionComparedKeys.some(key => row[key] !== replacement[key])) {
      changed.push({ before: row, replacement });
    }
  }
  return { ok: true, obsolete, changed, inserted: [...nextByKey.values()] };
}

/** SA-023 U03g: immutable snapshots => ordered D1 mutation descriptions.
 * The CURRENT/Hono adapters still own SQL, CAS, limits on DB reads, strict audits,
 * and atomic execution. Nothing in this helper performs a database operation. */
export type StageQuestionMutationStep<Old, New, Answer> =
  | { kind: "delete_answers"; rows: Answer[]; expected: number }
  | { kind: "delete_questions"; rows: Old[]; expected: number }
  | { kind: "update_question"; before: Old; replacement: New; expected: 1 }
  | { kind: "insert_questions"; rows: New[]; expected: number };

export type StageQuestionMutationPlan<Old, New, Answer> =
  | { ok: false; reason: "duplicate_existing_key" | "duplicate_next_key" | "answer_limit" | "unrelated_answer" | "stage_limit" }
  | {
      ok: true;
      operations: StageQuestionMutationStep<Old, New, Answer>[];
      expectedMutationChanges: number[];
      obsoleteIds: string[];
    };

/** Preserve CURRENT order: answer deletes, question deletes, changed-question
 * updates in old-row order, then inserts in groups of six in submitted order. */
export function planStageQuestionMutationSteps<
  Old extends StageQuestionDefinition & { id: string },
  New extends StageQuestionDefinition,
  Answer extends { question_id: string },
>(args: {
  existing: readonly Old[];
  next: readonly New[];
  deletedAnswers: readonly Answer[];
}): StageQuestionMutationPlan<Old, New, Answer> {
  const diff = planStageQuestionDiff(args.existing, args.next);
  if (!diff.ok) return diff;
  // CURRENT permits at most four stage/permission questions, not six.
  // The six-row SQL insert chunk limit is a different, generic D1 constraint.
  if (args.next.length > MAX_STAGE_PERMISSION_QUESTIONS) return { ok: false, reason: "stage_limit" };
  if (args.deletedAnswers.length > 20) return { ok: false, reason: "answer_limit" };
  const obsoleteIds = diff.obsolete.map(row => row.id);
  const obsoleteIdSet = new Set(obsoleteIds);
  if (args.deletedAnswers.some(row => !obsoleteIdSet.has(row.question_id))) {
    return { ok: false, reason: "unrelated_answer" };
  }
  const operations: StageQuestionMutationStep<Old, New, Answer>[] = [];
  if (args.deletedAnswers.length > 0) {
    operations.push({ kind: "delete_answers", rows: [...args.deletedAnswers], expected: args.deletedAnswers.length });
  }
  if (diff.obsolete.length > 0) {
    operations.push({ kind: "delete_questions", rows: diff.obsolete, expected: diff.obsolete.length });
  }
  for (const { before, replacement } of diff.changed) {
    operations.push({ kind: "update_question", before, replacement, expected: 1 });
  }
  for (let index = 0; index < diff.inserted.length; index += 6) {
    const rows = diff.inserted.slice(index, index + 6);
    operations.push({ kind: "insert_questions", rows, expected: rows.length });
  }
  return { ok: true, operations, expectedMutationChanges: operations.map(step => step.expected), obsoleteIds };
}

/** SA-023 U03h: exact CURRENT stage-question UPDATE projection and CAS identity.
 * DB adapter must use where(id = cas.id AND updated_at = cas.updated_at),
 * require one changed row and append the unchanged strict audit after-image. */
export function projectStageQuestionUpdate<
  Old extends { id: string; event_id: string; created_at: number; updated_at: number },
  New extends { id: string; event_id: string; created_at: number; updated_at: number },
>(before: Old, replacement: New) {
  const {
    id: _id,
    event_id: _eventId,
    created_at: _createdAt,
    ...updateValues
  } = replacement;
  return {
    cas: { id: before.id, updated_at: before.updated_at },
    updateValues,
    after: {
      ...before,
      ...replacement,
      id: before.id,
      created_at: before.created_at,
    },
  };
}

/** SA-023 U03n: stage-only Drizzle D1 CAS and strict-audit assembly.
 * Input rows MUST come from the server's capped, scoped SELECTs and validated
 * stage-question form parser. Caller must combine this with event CAS, queue
 * statements and other question families in ONE mutateWithAudit invocation.
 * This helper is deliberately not a route or DB executor. */
export function buildStageQuestionD1MutationBatch(input: {
  db: ServerCoreDb;
  eventId: string;
  existing: readonly (typeof eventCustomQuestions.$inferSelect)[];
  next: readonly (typeof eventCustomQuestions.$inferSelect)[];
  deletedAnswers: readonly (typeof videoCustomAnswers.$inferSelect)[];
  actorUserId: string;
  /** Actual logical queries already spent in this request before mutateWithAudit. */
  callerQueryCount: number;
}):
  | { ok: false; reason: Exclude<StageQuestionMutationPlan<never, never, never>, { ok: true }>["reason"] | "event_scope" | "query_budget" | "snapshot_limit" | "duplicate_identity" | "actor_identity" }
  | {
      ok: true;
      mutationStatements: BatchItem<"sqlite">[];
      expectedMutationChanges: number[];
      audits: WriteAuditLogInput[];
      budget: ReturnType<typeof planAtomicAuditMutationBudget>;
    } {
  if (!Number.isSafeInteger(input.callerQueryCount) || input.callerQueryCount < 0) {
    return { ok: false, reason: "query_budget" };
  }
  // Fail closed on foreign-event snapshots *before* generating any SQL.
  // The caller must still SELECT by event, enforce the 18/20 read caps and
  // authenticate; this is a second defense against accidentally mixed rows.
  if (!input.eventId ||
      input.existing.some(row => row.event_id !== input.eventId) ||
      input.next.some(row => row.event_id !== input.eventId) ||
      input.deletedAnswers.some(row => row.event_id !== input.eventId)) {
    return { ok: false, reason: "event_scope" };
  }
  // A scoped SELECT must have used LIMIT 19 for the CURRENT 18-row cap.
  // Never turn a truncated or oversized server snapshot into a mutation plan.
  if (input.existing.length > 18) return { ok: false, reason: "snapshot_limit" };
  if (!input.actorUserId.trim()) return { ok: false, reason: "actor_identity" };
  // The source primary keys must be unique before creating composite CAS ORs
  // and one strict audit per row. Duplicate key entries would otherwise make
  // expected changes() and audit cardinalities disagree.
  const oldIds = new Set<string>();
  for (const row of input.existing) {
    if (!row.id || oldIds.has(row.id)) return { ok: false, reason: "duplicate_identity" };
    oldIds.add(row.id);
  }
  const answerIds = new Set<string>();
  for (const row of input.deletedAnswers) {
    if (!row.video_id || !row.question_id) return { ok: false, reason: "duplicate_identity" };
    const key = JSON.stringify([row.video_id, row.event_id, row.question_id]);
    if (answerIds.has(key)) return { ok: false, reason: "duplicate_identity" };
    answerIds.add(key);
  }
  const stage = planStageQuestionMutationSteps(input);
  if (!stage.ok) return stage;
  // New rows must receive fresh IDs. A reused deleted ID can make unrelated
  // DELETE + CREATE audit snapshots look like one continuous entity; a
  // duplicate generated ID cannot satisfy an atomic multi-row INSERT.
  const newIds = new Set<string>();
  for (const step of stage.operations) {
    if (step.kind !== "insert_questions") continue;
    for (const row of step.rows) {
      if (!row.id || oldIds.has(row.id) || newIds.has(row.id)) {
        return { ok: false, reason: "duplicate_identity" };
      }
      newIds.add(row.id);
    }
  }
  const mutationStatements: BatchItem<"sqlite">[] = [];
  const audits: WriteAuditLogInput[] = [];
  for (const step of stage.operations) {
    if (step.kind === "delete_answers") {
      mutationStatements.push(input.db.delete(videoCustomAnswers).where(or(
        ...step.rows.map(row => and(
          eq(videoCustomAnswers.video_id, row.video_id),
          eq(videoCustomAnswers.event_id, row.event_id),
          eq(videoCustomAnswers.question_id, row.question_id),
          eq(videoCustomAnswers.updated_at, row.updated_at),
        )),
      )));
      audits.push(...step.rows.map(row => ({
        table_name: "video_custom_answers",
        target_id: `${row.video_id}:${row.event_id}:${row.question_id}`,
        operation: "DELETE" as const, before: row, after: null,
        actor_user_id: input.actorUserId,
        context: "event-update:removed-stage-question-answer",
        retention_class: "normal" as const, strict: true,
      })));
    } else if (step.kind === "delete_questions") {
      mutationStatements.push(input.db.delete(eventCustomQuestions).where(or(
        ...step.rows.map(row => and(
          eq(eventCustomQuestions.id, row.id),
          eq(eventCustomQuestions.updated_at, row.updated_at),
        )),
      )));
      audits.push(...step.rows.map(row => ({
        table_name: "event_custom_questions", target_id: row.id,
        operation: "DELETE" as const, before: row, after: null,
        actor_user_id: input.actorUserId,
        context: "event-update:removed-stage-question",
        retention_class: "normal" as const, strict: true,
      })));
    } else if (step.kind === "update_question") {
      const projected = projectStageQuestionUpdate(step.before, step.replacement);
      mutationStatements.push(input.db.update(eventCustomQuestions)
        .set(projected.updateValues).where(and(
          eq(eventCustomQuestions.id, projected.cas.id),
          eq(eventCustomQuestions.updated_at, projected.cas.updated_at),
        )));
      audits.push({
        table_name: "event_custom_questions", target_id: step.before.id,
        operation: "UPDATE", before: step.before, after: projected.after,
        actor_user_id: input.actorUserId,
        context: "event-update:stage-question",
        retention_class: "normal", strict: true,
      });
    } else {
      mutationStatements.push(input.db.insert(eventCustomQuestions).values(step.rows));
      audits.push(...step.rows.map(row => ({
        table_name: "event_custom_questions", target_id: row.id,
        operation: "CREATE" as const, before: null, after: row,
        actor_user_id: input.actorUserId,
        context: "event-update:stage-question",
        retention_class: "normal" as const, strict: true,
      })));
    }
  }
  const budget = planAtomicAuditMutationBudget({
    mutationStatements,
    expectedMutationChanges: stage.expectedMutationChanges,
    audits,
    callerQueryCount: input.callerQueryCount,
  });
  if (!budget.withinLimit) return { ok: false, reason: "query_budget" };
  return {
    ok: true,
    mutationStatements,
    expectedMutationChanges: stage.expectedMutationChanges,
    audits,
    budget,
  };
}

/** SA-023 U03s: combine caller-owned event/Queue/other-family DML with a
 * validated stage subplan. No DB access or mutation takes place here.
 * Caller MUST supply exact, authorized, scoped server snapshots and
 * an *actual* request-wide pre-mutation logical D1 read count.
 * The returned object goes to ONE mutateWithAudit invocation. */
export function combineEventStageD1MutationBatch(input: {
  base: Pick<AtomicAuditMutationInput,
    "mutationStatements" | "expectedMutationChanges" | "audits" |
    "preMutationAssertions" | "postMutationAssertions" | "postAuditStatements" | "preloaded">;
  stage: {
    ok: true;
    mutationStatements: BatchItem<"sqlite">[];
    expectedMutationChanges: number[];
    audits: WriteAuditLogInput[];
  };
  callerQueryCount: number;
}):
  | { ok: false; reason: "invalid_base" | "query_budget" }
  | {
      ok: true;
      plan: Pick<AtomicAuditMutationInput,
        "mutationStatements" | "expectedMutationChanges" | "audits" |
        "preMutationAssertions" | "postMutationAssertions" |
        "postAuditStatements" | "preloaded" | "callerQueryCount">;
      budget: ReturnType<typeof planAtomicAuditMutationBudget>;
    } {
  const baseExpected = input.base.expectedMutationChanges;
  if (!Array.isArray(baseExpected) ||
      baseExpected.length !== input.base.mutationStatements.length ||
      input.stage.expectedMutationChanges.length !== input.stage.mutationStatements.length ||
      [...baseExpected, ...input.stage.expectedMutationChanges].some(
        value => !Number.isSafeInteger(value) || value < 0
      ) ||
      [...input.base.audits, ...input.stage.audits].some(audit => audit.strict !== true) ||
      !Number.isSafeInteger(input.callerQueryCount) || input.callerQueryCount < 0) {
    return { ok: false, reason: "invalid_base" };
  }
  const plan = {
    mutationStatements: [...input.base.mutationStatements, ...input.stage.mutationStatements],
    expectedMutationChanges: [...baseExpected, ...input.stage.expectedMutationChanges],
    audits: [...input.base.audits, ...input.stage.audits],
    preMutationAssertions: input.base.preMutationAssertions,
    postMutationAssertions: input.base.postMutationAssertions,
    postAuditStatements: input.base.postAuditStatements,
    preloaded: input.base.preloaded,
    callerQueryCount: input.callerQueryCount,
  };
  const budget = planAtomicAuditMutationBudget(plan);
  if (!budget.withinLimit) return { ok: false, reason: "query_budget" };
  return { ok: true, plan, budget };
}
