import { z } from "zod";

// CURRENT: app/(manage)/manage/events/[id]/edit/page.tsx (EventForm initial values)

export const ManageGeneralQuestionDraftSchema = z.object({
  clientId: z.string(),
  question_key: z.string(),
  label: z.string(),
  description: z.string(),
  type: z.enum(["text", "textarea", "select", "radio", "checkbox"]),
  required: z.boolean(),
  options: z.array(z.string()),
  placeholder: z.string(),
  enabled: z.boolean(),
});

export const ManageEventEditResponseSchema = z.object({
  isAdmin: z.boolean(),
  pendingCount: z.number(),
  activeXUserId: z.string().nullable(),
  manageStaffXUserIds: z.array(z.string()),
  /** event.basic / event.publish / event.questions / event.slots */
  editableSections: z.object({ basic: z.boolean(), publish: z.boolean(), questions: z.boolean(), slots: z.boolean() }),
  /** EventForm `initial` */
  initial: z.object({
    id: z.string(),
    updated_at: z.number(),
    title: z.string(),
    event_type: z.enum(["event", "collabo", "type", "other"]),
    explanation: z.string().nullable(),
    youtube_description_template: z.string().nullable(),
    required_video_fields_json: z.string().nullable(),
    icon_url: z.string().nullable(),
    img_url: z.string().nullable(),
    accent_color: z.string().nullable(),
    start_time: z.number().nullable(),
    end_time: z.number().nullable(),
    entry_start_time: z.number().nullable(),
    entry_end_time: z.number().nullable(),
    visibility_status: z.string().nullable(),
    allow_user_video_event_links: z.number().nullable(),
    allow_unslotted_posts: z.number().nullable(),
    allow_user_video_edits: z.number().nullable(),
    user_video_edit_permission_keys_json: z.string().nullable(),
    video_form_settings_json: z.string().nullable(),
    custom_questions: z.array(ManageGeneralQuestionDraftSchema),
    max_slots_per_video: z.number().nullable(),
    max_slot_reservation_groups_per_xid: z.number().nullable(),
    slot_interval_minutes: z.number().nullable(),
    slot_part_gap_minutes: z.number().nullable(),
    slot_type: z.enum(["time", "count"]),
    slot_visibility_mode: z.enum(["public_name", "anonymous", "hidden"]),
    parts_json: z.string().nullable(),
    editable_fields: z.string().nullable(),
    review_settings: z.string().nullable(),
  }),
});

export type ManageEventEditResponse = z.infer<typeof ManageEventEditResponseSchema>;
