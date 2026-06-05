import type { events } from "@/lib/db/schema";
import type { EventFormInitial } from "@/components/admin/EventForm";

export type EventRow = typeof events.$inferSelect;

/**
 * テンプレートに保存する設定（開催日時・枠・作品・スタッフ承認は含めない）
 */
export interface EventTemplateSnapshot {
  event_type: "event" | "collabo" | "type" | "other";
  explanation: string | null;
  icon_url: string | null;
  img_url: string | null;
  accent_color: string | null;
  allow_user_video_event_links: number;
  allow_user_video_edits: number;
  user_video_edit_permission_keys_json: string | null;
  video_form_settings_json: string | null;
  max_slots_per_video: number;
  max_consecutive_slots_per_entry: number;
  slot_part_gap_minutes: number;
  slot_type: "time" | "count";
  slot_visibility_mode: "public_name" | "anonymous" | "hidden";
  parts_json: string | null;
  custom_questions: string | null;
  review_settings: string | null;
  editable_fields: string | null;
  repeat_rules: string | null;
}

export function snapshotFromEvent(event: EventRow): EventTemplateSnapshot {
  return {
    event_type: (event.event_type ?? "event") as EventTemplateSnapshot["event_type"],
    explanation: event.explanation,
    icon_url: event.icon_url,
    img_url: event.img_url,
    accent_color: event.accent_color,
    allow_user_video_event_links: event.allow_user_video_event_links,
    allow_user_video_edits: event.allow_user_video_edits,
    user_video_edit_permission_keys_json:
      event.user_video_edit_permission_keys_json,
    video_form_settings_json: event.video_form_settings_json,
    max_slots_per_video: event.max_slots_per_video,
    max_consecutive_slots_per_entry: event.max_consecutive_slots_per_entry,
    slot_part_gap_minutes: event.slot_part_gap_minutes ?? 15,
    slot_type: (event.slot_type ?? "time") as "time" | "count",
    slot_visibility_mode: (event.slot_visibility_mode ?? "public_name") as
      | "public_name"
      | "anonymous"
      | "hidden",
    parts_json: event.parts_json,
    custom_questions: event.custom_questions,
    review_settings: event.review_settings,
    editable_fields: event.editable_fields,
    repeat_rules: event.repeat_rules,
  };
}

export function parseEventTemplateSnapshot(
  raw: string,
): EventTemplateSnapshot | null {
  try {
    const parsed = JSON.parse(raw) as EventTemplateSnapshot;
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.event_type || !parsed.slot_type) return null;
    return parsed;
  } catch {
    return null;
  }
}

function partsJsonToText(value: string | null | undefined): string {
  if (!value) return "";
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return "";
    return parsed
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter(Boolean)
      .join("\n");
  } catch {
    return "";
  }
}

/** 新規イベントフォーム用の初期値（日時は空、公開フラグはオフ） */
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
    is_active: 0,
    is_entry_open: 0,
    is_archived: 0,
    allow_user_video_event_links: snapshot.allow_user_video_event_links,
    allow_user_video_edits: snapshot.allow_user_video_edits,
    user_video_edit_permission_keys_json:
      snapshot.user_video_edit_permission_keys_json,
    video_form_settings_json: snapshot.video_form_settings_json,
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

export { partsJsonToText };
