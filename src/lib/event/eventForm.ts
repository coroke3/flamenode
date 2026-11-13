import { z } from "zod";
import { normalizeOptionalEventId, buildVideoFormSettingsJsonCore } from "@flamenode/domain/event";
import {
  MAX_SLOTS_PER_VIDEO,
  MIN_SLOTS_PER_VIDEO,
} from "@/lib/slots/limits";
import { normalizeHttpUrl } from "@/lib/utils/url";
import { DEFAULT_STAGE_PERMISSION_FIELD } from "@/lib/video/formSettings";
import {
  normalizeEventVisibility,
  type EventVisibilityStatus,
} from "@/lib/utils/eventStatus";
import { validateEventDateValues } from "./eventFormValidation";
import {
  MAX_YOUTUBE_DESCRIPTION_TEMPLATE_LENGTH,
  normalizeYoutubeDescriptionTemplate,
} from "@/lib/event/youtubeDescriptionTemplate";

// Retain the CURRENT create/rename import surface while sharing the exact ID rule.
export { EVENT_ID_PATTERN } from "@flamenode/domain/event";

export const eventSchema = z.object({
  id: z.preprocess(
    normalizeOptionalEventId,
    z.string().trim().min(1).max(64).optional(),
  ),
  title: z.string().trim().min(1).max(200),
  event_type: z
    .enum(["event", "collabo", "type", "other"])
    .default("event"),
  explanation: z.string().trim().max(4000).optional().nullable(),
  youtube_description_template: z.preprocess(
    (value) =>
      typeof value === "string"
        ? normalizeYoutubeDescriptionTemplate(value)
        : value,
    z
      .string()
      .max(MAX_YOUTUBE_DESCRIPTION_TEMPLATE_LENGTH)
      .optional()
      .nullable(),
  ),
  icon_url: z.preprocess(
    (value) =>
      typeof value === "string"
        ? normalizeHttpUrl(value, { maxLength: 500 })
        : value,
    z.string().trim().max(500).optional().nullable(),
  ),
  img_url: z.preprocess(
    (value) =>
      typeof value === "string"
        ? normalizeHttpUrl(value, { maxLength: 500 })
        : value,
    z.string().trim().max(500).optional().nullable(),
  ),
  accent_color: z.string().trim().max(20).optional().nullable(),
  start_time: z.string().trim().optional().nullable(),
  end_time: z.string().trim().optional().nullable(),
  entry_start_time: z.string().trim().optional().nullable(),
  entry_end_time: z.string().trim().optional().nullable(),
  visibility_status: z.enum(["private", "public"]).optional(),
  allow_user_video_event_links: z.coerce.number().int().min(0).max(1).default(0),
  allow_unslotted_posts: z.coerce.number().int().min(0).max(1).default(0),
  allow_user_video_edits: z.coerce.number().int().min(0).max(1).default(0),
  user_video_edit_permission_keys_json: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .nullable(),
  max_slots_per_video: z.coerce
    .number()
    .int()
    .min(MIN_SLOTS_PER_VIDEO)
    .max(MAX_SLOTS_PER_VIDEO)
    .default(MIN_SLOTS_PER_VIDEO),
  max_slot_reservation_groups_per_xid: z.coerce
    .number()
    .int()
    .min(0)
    .max(100)
    .default(0),
  slot_interval_minutes: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? null : value,
    z.coerce.number().int().min(1).max(1440).nullable().optional(),
  ),
  slot_part_gap_minutes: z.coerce
    .number()
    .int()
    .min(1)
    .max(1440)
    .default(15),
  slot_type: z.enum(["time", "count"]).default("time"),
  slot_visibility_mode: z
    .enum(["public_name", "anonymous", "hidden"])
    .default("public_name"),
  parts_text: z.string().max(2000).optional().nullable(),
  template_id: z.string().trim().max(64).optional().nullable(),
  editable_fields: z.string().trim().max(4000).optional().nullable(),
  review_settings: z.string().trim().max(4000).optional().nullable(),
});

export type EventFormData = z.infer<typeof eventSchema>;

// CURRENT route imports remain stable while the pure parts planner lives in domain.
export { buildPartsJson } from "@flamenode/domain/event";

export function resolveSubmittedEventVisibility(
  data: Pick<EventFormData, "visibility_status">,
): EventVisibilityStatus {
  return normalizeEventVisibility(data.visibility_status);
}

/** Preserve CURRENT's Next-facing signature and fallback labels. */
export function buildVideoFormSettingsJson(formData: FormData): string {
  return buildVideoFormSettingsJsonCore(formData, DEFAULT_STAGE_PERMISSION_FIELD);
}

export function parseEventForm(
  formData: FormData,
): { ok: true; data: EventFormData } | { ok: false; message: string } {
  const parsed = eventSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "入力エラー",
    };
  }
  const data = parsed.data;
  const dateValidation = validateEventDateValues(data);
  if (!dateValidation.ok) {
    return { ok: false, message: dateValidation.message };
  }
  return { ok: true, data };
}
