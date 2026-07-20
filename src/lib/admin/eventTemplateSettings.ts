import type { events } from "@/lib/db/schema";
import type { EventFormInitial } from "@/components/admin/EventForm";
import {
  normalizeQuestionKey,
  parseQuestionType,
  parseVisibility,
  type CustomQuestionType,
  type CustomQuestionVisibility,
} from "../video/customQuestions.ts";

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

/** テンプレートに保存する設定。開催日時・スタッフ承認は含めない。 */
export interface EventTemplateSnapshot {
  event_type: "event" | "collabo" | "type" | "other";
  explanation: string | null;
  icon_url: string | null;
  img_url: string | null;
  accent_color: string | null;
  allow_user_video_event_links: number;
  allow_unslotted_posts: number;
  allow_user_video_edits: number;
  user_video_edit_permission_keys_json: string | null;
  video_form_settings_json: string | null;
  max_slots_per_video: number;
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
  const label =
    typeof item.label === "string" ? item.label.trim().slice(0, 120) : "";
  if (!questionKey || !label) return null;
  const optionsJson =
    typeof item.options_json === "string" && item.options_json.trim()
      ? item.options_json
      : null;
  const maxLength =
    typeof item.max_length === "number" && Number.isFinite(item.max_length)
      ? Math.max(1, Math.min(5000, Math.floor(item.max_length)))
      : null;
  const sortOrder =
    typeof item.sort_order === "number" && Number.isFinite(item.sort_order)
      ? Math.floor(item.sort_order)
      : index;

  return {
    question_key: questionKey,
    label,
    description:
      typeof item.description === "string"
        ? item.description.trim().slice(0, 1000) || null
        : null,
    type: parseQuestionType(item.type),
    required:
      item.required === true || item.required === 1 || item.required === "1",
    options_json: optionsJson,
    placeholder:
      typeof item.placeholder === "string"
        ? item.placeholder.trim().slice(0, 1000) || null
        : null,
    max_length: maxLength,
    sort_order: sortOrder,
    is_active:
      item.is_active !== false &&
      item.is_active !== 0 &&
      item.is_active !== "0",
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
  }
  return definitions;
}

export function snapshotFromEvent(
  event: EventRow,
  customQuestions: EventTemplateQuestionRow[] = [],
  videoFormSettingsJson: string | null = null,
): EventTemplateSnapshot {
  return {
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
    video_form_settings_json: videoFormSettingsJson,
    max_slots_per_video: event.max_slots_per_video,
    slot_part_gap_minutes: event.slot_part_gap_minutes ?? 15,
    slot_type: (event.slot_type ?? "time") as "time" | "count",
    slot_visibility_mode: (event.slot_visibility_mode ?? "public_name") as
      | "public_name"
      | "anonymous"
      | "hidden",
    parts_json: event.parts_json,
    custom_question_definitions: customQuestions.map(questionRowToTemplateDefinition),
    review_settings: event.review_settings,
    editable_fields: event.editable_fields,
    repeat_rules: event.repeat_rules,
  };
}

export function parseEventTemplateSnapshot(
  raw: string,
): EventTemplateSnapshot | null {
  try {
    const parsed = JSON.parse(raw) as EventTemplateSnapshot & {
      custom_question_definitions?: unknown;
    };
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.event_type || !parsed.slot_type) return null;
    const { custom_question_definitions } = parsed;
    const snapshot: Omit<EventTemplateSnapshot, "custom_question_definitions"> = {
      event_type: parsed.event_type,
      explanation: parsed.explanation ?? null,
      icon_url: parsed.icon_url ?? null,
      img_url: parsed.img_url ?? null,
      accent_color: parsed.accent_color ?? null,
      allow_user_video_event_links: parsed.allow_user_video_event_links ?? 0,
      allow_unslotted_posts: parsed.allow_unslotted_posts ?? 0,
      allow_user_video_edits: parsed.allow_user_video_edits ?? 0,
      user_video_edit_permission_keys_json:
        parsed.user_video_edit_permission_keys_json ?? null,
      video_form_settings_json: parsed.video_form_settings_json ?? null,
      max_slots_per_video: parsed.max_slots_per_video ?? 1,
      slot_part_gap_minutes: parsed.slot_part_gap_minutes ?? 15,
      slot_type: parsed.slot_type,
      slot_visibility_mode: parsed.slot_visibility_mode ?? "public_name",
      parts_json: parsed.parts_json ?? null,
      review_settings: parsed.review_settings ?? null,
      editable_fields: parsed.editable_fields ?? null,
      repeat_rules: parsed.repeat_rules ?? null,
    };
    return {
      ...snapshot,
      custom_question_definitions: normalizeTemplateQuestionDefinitions(
        custom_question_definitions,
      ),
    };
  } catch {
    return null;
  }
}

/** 新規イベントフォーム用の初期値。日時は空、公開状態は下書き。 */
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
    visibility_status: "private",
    allow_user_video_event_links: snapshot.allow_user_video_event_links,
    allow_unslotted_posts: snapshot.allow_unslotted_posts ?? 0,
    allow_user_video_edits: snapshot.allow_user_video_edits,
    user_video_edit_permission_keys_json:
      snapshot.user_video_edit_permission_keys_json,
    video_form_settings_json: snapshot.video_form_settings_json,
    max_slots_per_video: snapshot.max_slots_per_video,
    slot_part_gap_minutes: snapshot.slot_part_gap_minutes,
    slot_type: snapshot.slot_type,
    slot_visibility_mode: snapshot.slot_visibility_mode,
    parts_json: snapshot.parts_json,
    editable_fields: snapshot.editable_fields,
    review_settings: snapshot.review_settings,
  };
}
