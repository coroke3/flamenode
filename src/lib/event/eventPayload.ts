import type { events } from "@/lib/db/schema";
import {
  EVENT_SECTION_PERMISSION_KEYS,
  type EventEditSection,
} from "@/lib/admin/eventSectionFields";
import {
  buildVideoFormSettingsJson,
  resolveSubmittedEventVisibility,
  type EventFormData,
} from "@/lib/event/eventForm";
import { serializeRequiredVideoFieldsFromForm } from "@/lib/video/requiredVideoFields";
import { buildBasicEventUpdateFields, buildPublishEventUpdateFields, buildQuestionsEventUpdateFields, buildSlotsEventUpdateFields, parseDateInput, type EventEditPermissions } from "@flamenode/domain/event";

export type EventUpdatePayload = Partial<typeof events.$inferInsert>;

export { parseDateInput, type EventEditPermissions } from "@flamenode/domain/event";

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
