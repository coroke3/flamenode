/**
 * MIG-0652 U02 — pure CURRENT createEvent template/stage question row projection.
 *
 * The CURRENT/Hono adapter still owns parsing settings, validating template
 * snapshots, resolving/approving X identity, creating IDs and all D1/audit
 * writes. These helpers only map already-normalized inputs into insert rows.
 */
import type { EventTemplateSnapshot, EventTemplateQuestionDefinition } from "../eventTemplates/snapshots.ts";

export type EventCreateQuestionRow = {
  id: string;
  event_id: string;
  question_key: string;
  label: string;
  description: string | null;
  type: EventTemplateQuestionDefinition["type"];
  required: number;
  options_json: string | null;
  placeholder: string | null;
  max_length: number | null;
  sort_order: number;
  is_active: number;
  visibility: EventTemplateQuestionDefinition["visibility"];
  created_at: number;
  updated_at: number;
};

export type NormalizedCreateStageField = {
  id: string;
  label: string;
  description: string;
  placeholder: string;
  required: boolean;
};

/**
 * CURRENT stageQuestionRows maps the resolved (already enabled-filtered)
 * stage fields without changing their IDs or ordering.
 */
export function buildEventCreateStageQuestionRows(args: {
  eventId: string;
  fields: readonly NormalizedCreateStageField[];
  now: number;
  createId: () => string;
}): EventCreateQuestionRow[] {
  return args.fields.map((field, index): EventCreateQuestionRow => ({
    id: args.createId(),
    event_id: args.eventId,
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
    created_at: args.now,
    updated_at: args.now,
  }));
}

/**
 * CURRENT templateGeneralQuestionRows excludes stage-reserved keys before
 * assigning IDs. Inject the existing reserved-key predicate from the adapter.
 */
export function buildEventCreateTemplateQuestionRows(args: {
  eventId: string;
  templateSnapshot: Pick<EventTemplateSnapshot, "custom_question_definitions"> | null;
  now: number;
  createId: () => string;
  isStagePermissionQuestionKey: (key: string) => boolean;
}): EventCreateQuestionRow[] {
  return (args.templateSnapshot?.custom_question_definitions ?? [])
    .filter((definition) => !args.isStagePermissionQuestionKey(definition.question_key))
    .map((definition): EventCreateQuestionRow => ({
      id: args.createId(),
      event_id: args.eventId,
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
      created_at: args.now,
      updated_at: args.now,
    }));
}
