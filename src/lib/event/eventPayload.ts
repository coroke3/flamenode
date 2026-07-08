import type { events } from "@/lib/db/schema";
import { parseJstDatetimeLocal } from "@/lib/utils/dateInput";
import {
  EVENT_SECTION_PERMISSION_KEYS,
  type EventEditSection,
} from "@/lib/admin/eventSectionFields";
import {
  buildPartsJson,
  buildVideoFormSettingsJson,
  resolveSubmittedEventVisibility,
  type EventFormData,
} from "@/lib/event/eventForm";

export type EventUpdatePayload = Partial<typeof events.$inferInsert>;

export function parseDateInput(raw: string | null | undefined): number | null {
  return parseJstDatetimeLocal(raw);
}

export interface EventEditPermissions {
  basic: boolean;
  publish: boolean;
  questions: boolean;
  slots: boolean;
}

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
    Object.assign(updatePayload, {
      title: data.title,
      event_type: data.event_type,
      explanation: data.explanation ?? null,
      icon_url: data.icon_url ?? null,
      img_url: data.img_url ?? null,
      accent_color: data.accent_color ?? null,
      start_time: parseDateInput(data.start_time),
      end_time: parseDateInput(data.end_time),
    });
    updatedSections.push("basic");
    changedByPermission.basic = EVENT_SECTION_PERMISSION_KEYS.basic;
  }

  if (permissions.publish) {
    const visibilityStatus = resolveSubmittedEventVisibility(data);
    Object.assign(updatePayload, {
      visibility_status: visibilityStatus,
      entry_start_time: parseDateInput(data.entry_start_time),
      entry_end_time: parseDateInput(data.entry_end_time),
      allow_user_video_event_links: data.allow_user_video_event_links,
      allow_unslotted_posts: data.allow_unslotted_posts,
    });
    updatedSections.push("publish");
    changedByPermission.publish = EVENT_SECTION_PERMISSION_KEYS.publish;
  }

  if (permissions.questions) {
    videoFormSettingsJson = buildVideoFormSettingsJson(formData, data);
    Object.assign(updatePayload, {
      allow_user_video_edits: data.allow_user_video_edits,
      user_video_edit_permission_keys_json:
        data.user_video_edit_permission_keys_json ?? null,
      editable_fields: data.editable_fields ?? before.editable_fields,
      review_settings: data.review_settings ?? before.review_settings,
    });
    updatedSections.push("questions");
    changedByPermission.questions = EVENT_SECTION_PERMISSION_KEYS.questions;
  }

  if (permissions.slots) {
    Object.assign(updatePayload, {
      max_slots_per_video: data.max_slots_per_video,
      max_consecutive_slots_per_entry: data.max_consecutive_slots_per_entry,
      slot_part_gap_minutes: data.slot_part_gap_minutes,
      slot_type: data.slot_type,
      slot_visibility_mode: data.slot_visibility_mode,
      parts_json: buildPartsJson(data.parts_text),
    });
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
