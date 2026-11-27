/** CURRENT event update composition, shared without changing section or form semantics. */
import type { events } from "@flamenode/db/schema";
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
  | { ok: false; reason: "duplicate_existing_key" | "duplicate_next_key" | "answer_limit" | "unrelated_answer" }
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
