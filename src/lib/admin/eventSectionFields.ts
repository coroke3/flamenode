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
        max_consecutive_slots_per_entry: row.max_consecutive_slots_per_entry,
        slot_part_gap_minutes: row.slot_part_gap_minutes,
        slot_visibility_mode: row.slot_visibility_mode,
        parts_json: row.parts_json,
      };
  }
}

export function buildEventUpdateAuditPayload(args: {
  updatedSections: EventEditSection[];
  changedByPermission: Partial<Record<EventEditSection, string>>;
  before: EventRow;
  afterPayload: Record<string, unknown>;
}): { before_data: string; after_data: string } {
  const beforeSections: Partial<Record<EventEditSection, Record<string, unknown>>> =
    {};
  const afterSections: Partial<Record<EventEditSection, Record<string, unknown>>> =
    {};

  for (const section of args.updatedSections) {
    beforeSections[section] = snapshotEventSection(section, args.before);
    afterSections[section] = Object.fromEntries(
      Object.entries(snapshotEventSection(section, {
        ...args.before,
        ...args.afterPayload,
      } as EventRow)).filter(([key]) =>
        Object.prototype.hasOwnProperty.call(args.afterPayload, key) ||
        Object.prototype.hasOwnProperty.call(
          snapshotEventSection(section, args.before),
          key,
        ),
      ),
    );
  }

  return {
    before_data: JSON.stringify({
      updated_sections: args.updatedSections,
      sections: beforeSections,
    }),
    after_data: JSON.stringify({
      updated_sections: args.updatedSections,
      changed_by_permission: args.changedByPermission,
      sections: afterSections,
      update: args.afterPayload,
    }),
  };
}
