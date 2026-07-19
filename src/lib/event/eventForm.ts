import { z } from "zod";
import { normalizeHttpUrl } from "@/lib/utils/url";
import type { EventVisibilityStatus } from "@/lib/utils/eventStatus";

export const eventSchema = z.object({
  id: z.string().trim().min(1).max(64).optional(),
  title: z.string().trim().min(1).max(200),
  event_type: z
    .enum(["event", "collabo", "type", "other"])
    .default("event"),
  explanation: z.string().trim().max(4000).optional().nullable(),
  icon_url: z.preprocess(
    (val) => (typeof val === "string" ? normalizeHttpUrl(val, { maxLength: 500 }) : val),
    z.string().trim().max(500).optional().nullable(),
  ),
  img_url: z.preprocess(
    (val) => (typeof val === "string" ? normalizeHttpUrl(val, { maxLength: 500 }) : val),
    z.string().trim().max(500).optional().nullable(),
  ),
  accent_color: z.string().trim().max(20).optional().nullable(),
  start_time: z.string().trim().optional().nullable(),
  end_time: z.string().trim().optional().nullable(),
  entry_start_time: z.string().trim().optional().nullable(),
  entry_end_time: z.string().trim().optional().nullable(),
  visibility_status: z
    .enum(["draft", "private", "public", "archived"])
    .optional(),
  allow_user_video_event_links: z.coerce.number().min(0).max(1).default(0),
  allow_unslotted_posts: z.coerce.number().min(0).max(1).default(0),
  allow_user_video_edits: z.coerce.number().min(0).max(1).default(0),
  user_video_edit_permission_keys_json: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .nullable(),
  max_slots_per_video: z.coerce.number().min(1).max(20).default(1),
  max_consecutive_slots_per_entry: z.coerce.number().min(1).max(20).default(3),
  slot_part_gap_minutes: z.coerce.number().min(1).max(1440).default(15),
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

const PART_NAME_MAX_LEN = 40;
const PART_MAX_COUNT = 20;

export function buildPartsJson(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const truncated = trimmed.slice(0, PART_NAME_MAX_LEN);
    if (seen.has(truncated)) continue;
    seen.add(truncated);
    parts.push(truncated);
    if (parts.length >= PART_MAX_COUNT) break;
  }
  if (parts.length === 0) return null;
  return JSON.stringify(parts);
}

export function resolveSubmittedEventVisibility(
  data: Pick<EventFormData, "visibility_status">,
): EventVisibilityStatus {
  return data.visibility_status ?? "draft";
}

export function parseEventForm(
  formData: FormData,
): { ok: true; data: EventFormData } | { ok: false; message: string } {
  const parsed = eventSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "入力エラー" };
  }
  return { ok: true, data: parsed.data };
}
