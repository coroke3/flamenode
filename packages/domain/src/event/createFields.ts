/**
 * MIG-0652 U02 — framework-neutral event-create row field projection.
 *
 * Mirrors CURRENT createEvent's event row (not its owner, questions, audit,
 * tombstone, D1, R2 or Queue effects). The Hono create handler remains
 * unmounted until independently verified against CURRENT.
 */
import { buildBasicEventUpdateFields, type BasicEventUpdateInput } from "./basicUpdateFields.ts";
import { buildPublishEventUpdateFields, type PublishEventUpdateInput } from "./publishUpdateFields.ts";
import { buildSlotsEventUpdateFields, type SlotsEventUpdateInput } from "./slotsUpdateFields.ts";
import type { QuestionsEventUpdateInput } from "./questionsUpdateFields.ts";
import type { EventTemplateSnapshot } from "../eventTemplates/snapshots.ts";

export type CreateEventFieldsData =
  BasicEventUpdateInput &
  PublishEventUpdateInput &
  SlotsEventUpdateInput &
  Pick<QuestionsEventUpdateInput, "allow_user_video_edits" | "user_video_edit_permission_keys_json">;

export type CreateEventTemplateFields = Pick<
  EventTemplateSnapshot,
  "required_video_fields_json" | "review_settings" | "editable_fields" | "repeat_rules"
>;

/**
 * `undefined` means the required-fields widget was not sent and the template
 * default must be used. `null` is an explicit clear and must override it.
 * Template editor/review and repeat-rules policies are NOT sourced from the
 * incoming create form, matching CURRENT's createEvent implementation.
 */
export function buildEventCreateFields(input: {
  id: string;
  data: CreateEventFieldsData;
  visibilityStatus: "private" | "public";
  requiredVideoFieldsJson: string | null | undefined;
  templateSnapshot: CreateEventTemplateFields | null;
  now: number;
}) {
  const { id, data, visibilityStatus, templateSnapshot, now } = input;
  const basic = buildBasicEventUpdateFields({
    data, previousYoutubeDescriptionTemplate: null,
    hasYoutubeDescriptionTemplateField: true,
  });
  const publish = buildPublishEventUpdateFields({ data, visibilityStatus });
  const slots = buildSlotsEventUpdateFields(data);
  return {
    id,
    title: basic.title,
    event_type: basic.event_type,
    explanation: basic.explanation,
    youtube_description_template: basic.youtube_description_template,
    required_video_fields_json: input.requiredVideoFieldsJson !== undefined
      ? input.requiredVideoFieldsJson
      : templateSnapshot?.required_video_fields_json ?? null,
    icon_url: basic.icon_url,
    img_url: basic.img_url,
    accent_color: basic.accent_color,
    visibility_status: publish.visibility_status,
    allow_user_video_event_links: publish.allow_user_video_event_links,
    allow_unslotted_posts: publish.allow_unslotted_posts,
    allow_user_video_edits: data.allow_user_video_edits,
    user_video_edit_permission_keys_json: data.user_video_edit_permission_keys_json ?? null,
    start_time: basic.start_time,
    end_time: basic.end_time,
    entry_start_time: publish.entry_start_time,
    entry_end_time: publish.entry_end_time,
    max_slots_per_video: slots.max_slots_per_video,
    max_slot_reservation_groups_per_xid: slots.max_slot_reservation_groups_per_xid,
    slot_interval_minutes: slots.slot_interval_minutes,
    slot_part_gap_minutes: slots.slot_part_gap_minutes,
    slot_type: slots.slot_type,
    slot_visibility_mode: slots.slot_visibility_mode,
    parts_json: slots.parts_json,
    review_settings: templateSnapshot?.review_settings ?? null,
    editable_fields: templateSnapshot?.editable_fields ?? null,
    repeat_rules: templateSnapshot?.repeat_rules ?? null,
    public_api_enabled: 0 as const,
    created_at: now,
    updated_at: now,
  };
}
