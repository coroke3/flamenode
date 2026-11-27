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
