import type { events } from "@/lib/db/schema";
import type { EventFormInitial } from "@/components/admin/EventForm";
import {
  normalizeQuestionKey,
  parseOptionsJson,
  parseQuestionType,
  parseVisibility,
  type CustomQuestionType,
  type CustomQuestionVisibility,
  type EditableCustomQuestion,
} from "../video/customQuestions.ts";
import {
  getStagePermissionQuestions,
  parseVideoFormSettings,
} from "../video/formSettings.ts";
import { MAX_EVENT_CUSTOM_QUESTIONS } from "../video/customQuestionLimits.ts";

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
  is_active: boolean;
  visibility: CustomQuestionVisibility;
}

/**
 * テンプレートに保存する設定（開催日時・枠・作品・スタッフ承認は含めない）。
 * 質問は custom_question_definitions のみを正本とし、旧フォームJSONへ二重保存しない。
 */
export interface EventTemplateSnapshot {
  schema_version: 2;
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

function questionRowToTemplateDefinition(
  row: EventTemplateQuestionRow,
): EventTemplateQuestionDefinition {
  return {
    question_key: row.question_key,
    label: row.label,
    description: row.description,
    type: parseQuestionType(row.type),
    required: row.required === 1,
    options_json: row.options_json,
    placeholder: row.placeholder,
    max_length: row.max_length,
    sort_order: row.sort_order,
    is_active: row.is_active === 1,
    visibility: parseVisibility(row.visibility),
  };
}

function normalizeTemplateQuestionDefinition(
  raw: unknown,
  index: number,
): EventTemplateQuestionDefinition | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  const questionKey = normalizeQuestionKey(item.question_key);
  const label = typeof item.label === "string" ? item.label.trim().slice(0, 120) : "";
  if (!questionKey || !label) return null;
  const type = parseQuestionType(item.type);
  const parsedOptions = typeof item.options_json === "string"
    ? parseOptionsJson(item.options_json)
    : Array.isArray(item.options)
      ? item.options.filter((value): value is string => typeof value === "string")
      : [];
  const optionsJson = parsedOptions.length > 0 ? JSON.stringify(parsedOptions) : null;
  if ((type === "select" || type === "radio" || type === "checkbox") && !optionsJson) {
    return null;
  }
  const maxLength = typeof item.max_length === "number" && Number.isFinite(item.max_length)
    ? Math.max(1, Math.min(5000, Math.floor(item.max_length)))
    : null;
  const sortOrder = typeof item.sort_order === "number" && Number.isFinite(item.sort_order)
    ? Math.floor(item.sort_order)
    : index;

  return {
    question_key: questionKey,
    label,
    description: typeof item.description === "string"
      ? item.description.trim().slice(0, 1000) || null
      : null,
    type,
    required: item.required === true || item.required === 1 || item.required === "1",
    options_json: optionsJson,
    placeholder: typeof item.placeholder === "string"
      ? item.placeholder.trim().slice(0, 500) || null
      : null,
    max_length: maxLength,
    sort_order: sortOrder,
    is_active: item.is_active !== false && item.is_active !== 0 && item.is_active !== "0",
    visibility: parseVisibility(item.visibility),
  };
}

export function normalizeTemplateQuestionDefinitions(
  raw: unknown,
): EventTemplateQuestionDefinition[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const definitions: EventTemplateQuestionDefinition[] = [];
  for (const [index, item] of raw.entries()) {
    const normalized = normalizeTemplateQuestionDefinition(item, index);
    if (!normalized || seen.has(normalized.question_key)) continue;
    seen.add(normalized.question_key);
    definitions.push(normalized);
    if (definitions.length >= MAX_EVENT_CUSTOM_QUESTIONS) break;
  }
  return definitions;
}

function legacyQuestionsFromVideoFormSettings(raw: unknown): EventTemplateQuestionDefinition[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  return getStagePermissionQuestions(parseVideoFormSettings(raw))
    .filter((question) => question.enabled)
    .slice(0, MAX_EVENT_CUSTOM_QUESTIONS)
    .map((question, index) => ({
      question_key: normalizeQuestionKey(question.id),
      label: question.label.trim().slice(0, 120),
      description: question.description.trim().slice(0, 1000) || null,
      type: "textarea" as const,
      required: question.required,
      options_json: null,
      placeholder: question.placeholder.trim().slice(0, 500) || null,
      max_length: 1000,
      sort_order: index,
      is_active: true,
      visibility: "review" as const,
    }))
    .filter((question) => question.question_key && question.label);
}

export function snapshotFromEvent(
  event: EventRow,
  customQuestions: EventTemplateQuestionRow[] = [],
): EventTemplateSnapshot {
  return {
    schema_version: 2,
    event_type: (event.event_type ?? "event") as EventTemplateSnapshot["event_type"],
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
    slot_part_gap_minutes: event.slot_part_gap_minutes ?? 15,
    slot_type: (event.slot_type ?? "time") as "time" | "count",
    slot_visibility_mode: (event.slot_visibility_mode ?? "public_name") as
      | "public_name"
      | "anonymous"
      | "hidden",
    parts_json: event.parts_json,
    custom_question_definitions: customQuestions
      .filter((question) => question.is_active === 1)
      .slice(0, MAX_EVENT_CUSTOM_QUESTIONS)
      .map(questionRowToTemplateDefinition),
    review_settings: event.review_settings,
    editable_fields: event.editable_fields,
    repeat_rules: event.repeat_rules,
  };
}

export function parseEventTemplateSnapshot(
  raw: string,
): EventTemplateSnapshot | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;
    const eventType = parsed.event_type;
    const slotType = parsed.slot_type;
    if (
      eventType !== "event" && eventType !== "collabo" &&
      eventType !== "type" && eventType !== "other"
    ) return null;
    if (slotType !== "time" && slotType !== "count") return null;

    const normalized = normalizeTemplateQuestionDefinitions(
      parsed.custom_question_definitions,
    );
    const legacy = legacyQuestionsFromVideoFormSettings(parsed.video_form_settings_json);
    const seen = new Set(normalized.map((question) => question.question_key));
    const questions = [...normalized];
    for (const question of legacy) {
      if (seen.has(question.question_key)) continue;
      seen.add(question.question_key);
      questions.push(question);
      if (questions.length >= MAX_EVENT_CUSTOM_QUESTIONS) break;
    }

    const visibilityMode = parsed.slot_visibility_mode;
    return {
      schema_version: 2,
      event_type: eventType,
      explanation: typeof parsed.explanation === "string" ? parsed.explanation : null,
      icon_url: typeof parsed.icon_url === "string" ? parsed.icon_url : null,
      img_url: typeof parsed.img_url === "string" ? parsed.img_url : null,
      accent_color: typeof parsed.accent_color === "string" ? parsed.accent_color : null,
      allow_user_video_event_links: Number(parsed.allow_user_video_event_links) === 1 ? 1 : 0,
      allow_unslotted_posts: Number(parsed.allow_unslotted_posts) === 1 ? 1 : 0,
      allow_user_video_edits: Number(parsed.allow_user_video_edits) === 1 ? 1 : 0,
      user_video_edit_permission_keys_json:
        typeof parsed.user_video_edit_permission_keys_json === "string"
          ? parsed.user_video_edit_permission_keys_json
          : null,
      max_slots_per_video: Number(parsed.max_slots_per_video) || 1,
      max_consecutive_slots_per_entry:
        Number(parsed.max_consecutive_slots_per_entry) || 3,
      slot_part_gap_minutes: Number(parsed.slot_part_gap_minutes) || 15,
      slot_type: slotType,
      slot_visibility_mode:
        visibilityMode === "anonymous" || visibilityMode === "hidden"
          ? visibilityMode
          : "public_name",
      parts_json: typeof parsed.parts_json === "string" ? parsed.parts_json : null,
      custom_question_definitions: questions,
      review_settings: typeof parsed.review_settings === "string" ? parsed.review_settings : null,
      editable_fields: typeof parsed.editable_fields === "string" ? parsed.editable_fields : null,
      repeat_rules: typeof parsed.repeat_rules === "string" ? parsed.repeat_rules : null,
    };
  } catch {
    return null;
  }
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
    sort_order: definition.sort_order,
    is_active: definition.is_active,
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
