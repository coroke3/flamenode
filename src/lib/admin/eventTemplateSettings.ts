import type { events } from "@/lib/db/schema";
import type { EventFormInitial } from "@/components/admin/EventForm";
import {
  isCustomQuestionType,
  isCustomQuestionVisibility,
  isValidCustomQuestionKey,
  parseOptionsJson,
  type CustomQuestionType,
  type CustomQuestionVisibility,
  type EditableCustomQuestion,
} from "../video/customQuestions.ts";
import {
  MAX_CUSTOM_QUESTION_CONFIGURED_LENGTH,
  MAX_CUSTOM_QUESTION_DESCRIPTION_LENGTH,
  MAX_CUSTOM_QUESTION_LABEL_LENGTH,
  MAX_CUSTOM_QUESTION_PLACEHOLDER_LENGTH,
  MAX_EVENT_CUSTOM_QUESTIONS,
} from "../video/customQuestionLimits.ts";

export type EventRow = typeof events.$inferSelect;
export type EventTemplateQuestionRow = {
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
};

export interface EventTemplateQuestionDefinition {
  question_key: string;
  label: string;
  description: string | null;
  type: CustomQuestionType;
  required: boolean;
  options_json: string | null;
  placeholder: string | null;
  max_length: number | null;
  sort_order: number;
  is_active: true;
  visibility: CustomQuestionVisibility;
}

/**
 * テンプレートに保存する設定（開催日時・枠・作品・スタッフ承認は含めない）。
 * schema v3だけを受理し、旧schemaや別形式への補正は行わない。
 */
export interface EventTemplateSnapshot {
  schema_version: 3;
  event_type: "event" | "collabo" | "type" | "other";
  explanation: string | null;
  icon_url: string | null;
  img_url: string | null;
  accent_color: string | null;
  allow_user_video_event_links: number;
  allow_unslotted_posts: number;
  allow_user_video_edits: number;
  user_video_edit_permission_keys_json: string | null;
  max_slots_per_video: number;
  max_consecutive_slots_per_entry: number;
  slot_part_gap_minutes: number;
  slot_type: "time" | "count";
  slot_visibility_mode: "public_name" | "anonymous" | "hidden";
  parts_json: string | null;
  custom_question_definitions: EventTemplateQuestionDefinition[];
  review_settings: string | null;
  editable_fields: string | null;
  repeat_rules: string | null;
}

type UnknownRecord = Record<string, unknown>;

const SNAPSHOT_KEYS = new Set([
  "schema_version",
  "event_type",
  "explanation",
  "icon_url",
  "img_url",
  "accent_color",
  "allow_user_video_event_links",
  "allow_unslotted_posts",
  "allow_user_video_edits",
  "user_video_edit_permission_keys_json",
  "max_slots_per_video",
  "max_consecutive_slots_per_entry",
  "slot_part_gap_minutes",
  "slot_type",
  "slot_visibility_mode",
  "parts_json",
  "custom_question_definitions",
  "review_settings",
  "editable_fields",
  "repeat_rules",
]);

const QUESTION_KEYS = new Set([
  "question_key",
  "label",
  "description",
  "type",
  "required",
  "options_json",
  "placeholder",
  "max_length",
  "sort_order",
  "is_active",
  "visibility",
]);

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: UnknownRecord, expected: ReadonlySet<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isCanonicalNullableText(value: unknown, maxLength: number): value is string | null {
  return value === null || (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value === value.trim()
  );
}

function isFlag(value: unknown): value is 0 | 1 {
  return value === 0 || value === 1;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

function isEventType(value: unknown): value is EventTemplateSnapshot["event_type"] {
  return value === "event" || value === "collabo" || value === "type" || value === "other";
}

function isSlotType(value: unknown): value is EventTemplateSnapshot["slot_type"] {
  return value === "time" || value === "count";
}

function isSlotVisibilityMode(
  value: unknown,
): value is EventTemplateSnapshot["slot_visibility_mode"] {
  return value === "public_name" || value === "anonymous" || value === "hidden";
}

function validateQuestionOptions(
  type: CustomQuestionType,
  optionsJson: string | null,
): boolean {
  let options: string[];
  try {
    options = parseOptionsJson(optionsJson);
  } catch {
    return false;
  }
  const usesOptions = type === "select" || type === "radio" || type === "checkbox";
  return usesOptions ? options.length > 0 : options.length === 0;
}

function parseTemplateQuestionDefinition(
  value: unknown,
  index: number,
): EventTemplateQuestionDefinition | null {
  if (!isRecord(value) || !hasExactKeys(value, QUESTION_KEYS)) return null;
  if (!isValidCustomQuestionKey(value.question_key)) return null;
  if (
    typeof value.label !== "string" ||
    !value.label ||
    value.label !== value.label.trim() ||
    value.label.length > MAX_CUSTOM_QUESTION_LABEL_LENGTH
  ) return null;
  if (!isCanonicalNullableText(value.description, MAX_CUSTOM_QUESTION_DESCRIPTION_LENGTH)) {
    return null;
  }
  if (!isCanonicalNullableText(value.placeholder, MAX_CUSTOM_QUESTION_PLACEHOLDER_LENGTH)) {
    return null;
  }
  if (!isCustomQuestionType(value.type)) return null;
  if (!isCustomQuestionVisibility(value.visibility)) return null;
  if (typeof value.required !== "boolean") return null;
  if (value.options_json !== null && typeof value.options_json !== "string") return null;
  if (!validateQuestionOptions(value.type, value.options_json)) return null;
  if (value.is_active !== true || value.sort_order !== index) return null;

  const maxLength = value.max_length;
  if (
    maxLength !== null &&
    (!isPositiveInteger(maxLength) || maxLength > MAX_CUSTOM_QUESTION_CONFIGURED_LENGTH)
  ) return null;
  const usesOptions = value.type === "select" || value.type === "radio" || value.type === "checkbox";
  if (usesOptions && maxLength !== null) return null;

  return {
    question_key: value.question_key,
    label: value.label,
    description: value.description,
    type: value.type,
    required: value.required,
    options_json: value.options_json,
    placeholder: value.placeholder,
    max_length: maxLength,
    sort_order: index,
    is_active: true,
    visibility: value.visibility,
  };
}

function questionRowToTemplateDefinition(
  row: EventTemplateQuestionRow,
  index: number,
): EventTemplateQuestionDefinition {
  const definition = parseTemplateQuestionDefinition({
    question_key: row.question_key,
    label: row.label,
    description: row.description,
    type: row.type,
    required: row.required === 1,
    options_json: row.options_json,
    placeholder: row.placeholder,
    max_length: row.max_length,
    sort_order: index,
    is_active: row.is_active === 1,
    visibility: row.visibility,
  }, index);
  if (!definition) throw new Error("invalid_event_template_question_row");
  return definition;
}

export function snapshotFromEvent(
  event: EventRow,
  customQuestions: EventTemplateQuestionRow[] = [],
): EventTemplateSnapshot {
  if (!isEventType(event.event_type)) throw new Error("invalid_event_template_event_type");
  if (!isSlotType(event.slot_type)) throw new Error("invalid_event_template_slot_type");
  if (!isSlotVisibilityMode(event.slot_visibility_mode)) {
    throw new Error("invalid_event_template_slot_visibility_mode");
  }
  if (!isNonNegativeInteger(event.slot_part_gap_minutes)) {
    throw new Error("invalid_event_template_slot_part_gap_minutes");
  }

  const activeQuestions = customQuestions.filter((question) => question.is_active === 1);
  if (activeQuestions.length > MAX_EVENT_CUSTOM_QUESTIONS) {
    throw new Error("event_template_question_limit_exceeded");
  }

  return {
    schema_version: 3,
    event_type: event.event_type,
    explanation: event.explanation,
    icon_url: event.icon_url,
    img_url: event.img_url,
    accent_color: event.accent_color,
    allow_user_video_event_links: event.allow_user_video_event_links,
    allow_unslotted_posts: event.allow_unslotted_posts,
    allow_user_video_edits: event.allow_user_video_edits,
    user_video_edit_permission_keys_json:
      event.user_video_edit_permission_keys_json,
    max_slots_per_video: event.max_slots_per_video,
    max_consecutive_slots_per_entry: event.max_consecutive_slots_per_entry,
    slot_part_gap_minutes: event.slot_part_gap_minutes,
    slot_type: event.slot_type,
    slot_visibility_mode: event.slot_visibility_mode,
    parts_json: event.parts_json,
    custom_question_definitions: activeQuestions.map(questionRowToTemplateDefinition),
    review_settings: event.review_settings,
    editable_fields: event.editable_fields,
    repeat_rules: event.repeat_rules,
  };
}

export function parseEventTemplateSnapshot(
  raw: string,
): EventTemplateSnapshot | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !hasExactKeys(parsed, SNAPSHOT_KEYS)) return null;
  if (parsed.schema_version !== 3) return null;
  if (!isEventType(parsed.event_type)) return null;
  if (!isSlotType(parsed.slot_type)) return null;
  if (!isSlotVisibilityMode(parsed.slot_visibility_mode)) return null;
  if (!isFlag(parsed.allow_user_video_event_links)) return null;
  if (!isFlag(parsed.allow_unslotted_posts)) return null;
  if (!isFlag(parsed.allow_user_video_edits)) return null;
  if (!isPositiveInteger(parsed.max_slots_per_video)) return null;
  if (!isPositiveInteger(parsed.max_consecutive_slots_per_entry)) return null;
  if (!isNonNegativeInteger(parsed.slot_part_gap_minutes)) return null;
  if (!isNullableString(parsed.explanation)) return null;
  if (!isNullableString(parsed.icon_url)) return null;
  if (!isNullableString(parsed.img_url)) return null;
  if (!isNullableString(parsed.accent_color)) return null;
  if (!isNullableString(parsed.user_video_edit_permission_keys_json)) return null;
  if (!isNullableString(parsed.parts_json)) return null;
  if (!isNullableString(parsed.review_settings)) return null;
  if (!isNullableString(parsed.editable_fields)) return null;
  if (!isNullableString(parsed.repeat_rules)) return null;
  if (!Array.isArray(parsed.custom_question_definitions)) return null;
  if (parsed.custom_question_definitions.length > MAX_EVENT_CUSTOM_QUESTIONS) return null;

  const seen = new Set<string>();
  const definitions: EventTemplateQuestionDefinition[] = [];
  for (const [index, value] of parsed.custom_question_definitions.entries()) {
    const definition = parseTemplateQuestionDefinition(value, index);
    if (!definition || seen.has(definition.question_key)) return null;
    seen.add(definition.question_key);
    definitions.push(definition);
  }

  return {
    schema_version: 3,
    event_type: parsed.event_type,
    explanation: parsed.explanation,
    icon_url: parsed.icon_url,
    img_url: parsed.img_url,
    accent_color: parsed.accent_color,
    allow_user_video_event_links: parsed.allow_user_video_event_links,
    allow_unslotted_posts: parsed.allow_unslotted_posts,
    allow_user_video_edits: parsed.allow_user_video_edits,
    user_video_edit_permission_keys_json:
      parsed.user_video_edit_permission_keys_json,
    max_slots_per_video: parsed.max_slots_per_video,
    max_consecutive_slots_per_entry: parsed.max_consecutive_slots_per_entry,
    slot_part_gap_minutes: parsed.slot_part_gap_minutes,
    slot_type: parsed.slot_type,
    slot_visibility_mode: parsed.slot_visibility_mode,
    parts_json: parsed.parts_json,
    custom_question_definitions: definitions,
    review_settings: parsed.review_settings,
    editable_fields: parsed.editable_fields,
    repeat_rules: parsed.repeat_rules,
  };
}

function definitionToEditableQuestion(
  definition: EventTemplateQuestionDefinition,
  index: number,
): EditableCustomQuestion {
  return {
    id: `template_${index}_${definition.question_key}`,
    question_key: definition.question_key,
    label: definition.label,
    description: definition.description,
    type: definition.type,
    required: definition.required,
    options: parseOptionsJson(definition.options_json),
    placeholder: definition.placeholder,
    max_length: definition.max_length,
    sort_order: index,
    is_active: true,
    visibility: definition.visibility,
  };
}

/** 新規イベントフォーム用の初期値（日時は空、公開状態は下書き）。 */
export function snapshotToFormInitial(
  snapshot: EventTemplateSnapshot,
): EventFormInitial {
  return {
    event_type: snapshot.event_type,
    explanation: snapshot.explanation,
    icon_url: snapshot.icon_url,
    img_url: snapshot.img_url,
    accent_color: snapshot.accent_color,
    start_time: null,
    end_time: null,
    entry_start_time: null,
    entry_end_time: null,
    visibility_status: "draft",
    allow_user_video_event_links: snapshot.allow_user_video_event_links,
    allow_unslotted_posts: snapshot.allow_unslotted_posts,
    allow_user_video_edits: snapshot.allow_user_video_edits,
    user_video_edit_permission_keys_json:
      snapshot.user_video_edit_permission_keys_json,
    custom_questions: snapshot.custom_question_definitions.map(definitionToEditableQuestion),
    max_slots_per_video: snapshot.max_slots_per_video,
    max_consecutive_slots_per_entry: snapshot.max_consecutive_slots_per_entry,
    slot_part_gap_minutes: snapshot.slot_part_gap_minutes,
    slot_type: snapshot.slot_type,
    slot_visibility_mode: snapshot.slot_visibility_mode,
    parts_json: snapshot.parts_json,
    editable_fields: snapshot.editable_fields,
    review_settings: snapshot.review_settings,
  };
}
