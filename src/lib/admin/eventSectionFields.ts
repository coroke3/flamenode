import type { events } from "@/lib/db/schema";

export type EventEditSection = "basic" | "publish" | "questions" | "slots";

export const EVENT_SECTION_PERMISSION_KEYS = {
  basic: "event.basic",
  publish: "event.publish",
  questions: "event.questions",
  slots: "event.slots",
} as const satisfies Record<EventEditSection, string>;

type EventRow = typeof events.$inferSelect;

export function snapshotEventSection(
  section: EventEditSection,
  row: Pick<EventRow, keyof EventRow>,
): Record<string, unknown> {
  switch (section) {
    case "basic":
      return {
        title: row.title,
        event_type: row.event_type,
        explanation: row.explanation,
        icon_url: row.icon_url,
        img_url: row.img_url,
        accent_color: row.accent_color,
        start_time: row.start_time,
        end_time: row.end_time,
      };
    case "publish":
      return {
        visibility_status: row.visibility_status,
        entry_start_time: row.entry_start_time,
        entry_end_time: row.entry_end_time,
        allow_user_video_event_links: row.allow_user_video_event_links,
        allow_unslotted_posts: row.allow_unslotted_posts,
      };
    case "questions":
      return {
        allow_user_video_edits: row.allow_user_video_edits,
        user_video_edit_permission_keys_json:
          row.user_video_edit_permission_keys_json,
        editable_fields: row.editable_fields,
        review_settings: row.review_settings,
      };
    case "slots":
      return {
        slot_type: row.slot_type,
        max_slots_per_video: row.max_slots_per_video,
        slot_part_gap_minutes: row.slot_part_gap_minutes,
        slot_visibility_mode: row.slot_visibility_mode,
        parts_json: row.parts_json,
      };
  }
}
