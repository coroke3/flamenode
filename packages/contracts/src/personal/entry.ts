import { z } from "zod";
import { OnboardingStateSchema, PersonalUserSchema } from "./shared.ts";

// MIG-0623: DTOs for the authenticated Entry read APIs (/api/personal/entry/*).
// CURRENT sources: app/(auth)/entry/{page,slotted/page,unslotted/page}.tsx. Only the data those pages render or
// pass to the post forms is returned (no reserved_by_user_id, no email, no other users' slots).

/**
 * Paging of the event lists (ZERO_1102 S2: at most 100 rows and 64 KiB per response). `truncated` = more rows may follow;
 * `nextOffset` = the `?offset=` that continues the list (null when complete). A full page of exactly 100 rows reports
 * truncated and its continuation can be empty.
 */
const pagingShape = { truncated: z.boolean(), nextOffset: z.number().nullable() };

export const EntryEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  entry_end_time: z.number().nullable(),
  /** COUNT of this event's slots with status = 'available' (CURRENT slotCounts.get(id) ?? 0). */
  slots_available: z.number(),
});

export const EntryReservedSlotSchema = z.object({
  id: z.string(),
  event_id: z.string(),
  video_id: z.string().nullable(),
  slot_label: z.string().nullable(),
  start_time: z.number().nullable(),
  status: z.enum(["reserved", "submitted"]),
  event_title: z.string().nullable(),
  event_entry_end_time: z.number().nullable(),
});

/** GET /api/personal/entry?offset=N (pages `events`). `reservedSlots` is already in CURRENT's display order. */
export const EntryIndexResponseSchema = z.object({
  user: PersonalUserSchema,
  state: OnboardingStateSchema,
  events: z.array(EntryEventSchema),
  reservedSlots: z.array(EntryReservedSlotSchema),
  ...pagingShape,
});

export const EntryCustomQuestionSchema = z.object({
  id: z.string(),
  event_id: z.string(),
  question_key: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  type: z.enum(["text", "textarea", "select", "radio", "checkbox"]),
  required: z.boolean(),
  options: z.array(z.string()),
  placeholder: z.string().nullable(),
  max_length: z.number().nullable(),
  sort_order: z.number(),
  is_active: z.boolean(),
  visibility: z.enum(["review", "private", "public"]),
});

/**
 * Why the form is blocked (CURRENT submitBlockedReason). The Japanese message text stays in the UI.
 * no_active_x: no active X ID / not_linked: active X is not linked to the user /
 * pending | rejected | not_approved: the active X row's approval_status.
 */
export const EntrySubmitBlockSchema = z
  .enum(["no_active_x", "not_linked", "pending", "rejected", "not_approved"])
  .nullable();

export const EntryInitialProfileSchema = z.object({
  display_name: z.string(),
  icon_url: z.string().nullable(),
  profile_text: z.string().nullable(),
  youtube_channel_url: z.string().nullable(),
  other_social_links: z.string().nullable(),
});

export const EntryXIdOptionSchema = z.object({ id: z.string(), x_name: z.string() });

/** One selectable event of the post forms. `youtube_description_event_url` is derived by the UI from the id. */
export const EntryEventOptionSchema = z.object({
  id: z.string(),
  title: z.string(),
  parts_json: z.string().nullable(),
  youtube_description_template: z.string().nullable(),
  required_video_fields_json: z.string().nullable(),
  custom_questions: z.array(EntryCustomQuestionSchema),
});

export const SlottedEventOptionSchema = EntryEventOptionSchema.extend({
  video_form_settings_json: z.string().nullable(),
});

export const UnslottedEventOptionSchema = EntryEventOptionSchema.extend({
  status_label: z.string(),
});

const formCommonShape = {
  user: PersonalUserSchema,
  /** CURRENT activeX: the slot's x_user_id snapshot, else the user's active X ID (slotted); the user's active X ID (unslotted). */
  activeXId: z.string().nullable(),
  submitBlock: EntrySubmitBlockSchema,
  initialProfile: EntryInitialProfileSchema,
  xIdOptions: z.array(EntryXIdOptionSchema),
  softwareSuggestions: z.array(z.string()),
  iconCandidates: z.array(z.string()),
  channelCandidates: z.array(z.string()),
};

/** GET /api/personal/entry/slotted?slot=ID&offset=N (pages `eventOptions`). CURRENT redirects are returned as `redirect`; not-found is HTTP 404. */
export const SlottedEntryResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("redirect"), to: z.string() }),
  z.object({
    kind: z.literal("ready"),
    ...formCommonShape,
    slot: z.object({
      id: z.string(),
      slot_label: z.string().nullable(),
      display_name: z.string().nullable(),
      has_reservation_group: z.boolean(),
      /** reserved_x_id_snapshot ?? x_user_id (CURRENT reservedAtXId). */
      reserved_at_x_id: z.string().nullable(),
      start_time: z.number().nullable(),
      end_time: z.number().nullable(),
      group_size: z.number(),
    }),
    event: z.object({ id: z.string(), title: z.string() }),
    /** CURRENT xRow?.x_name (the "確保名" fallback chain input). */
    activeXName: z.string().nullable(),
    slotPart: z.string().nullable(),
    eventOptions: z.array(SlottedEventOptionSchema),
    ...pagingShape,
  }),
]);

/** GET /api/personal/entry/unslotted?event_q=TEXT&offset=N (pages `eventOptions`). */
export const UnslottedEntryResponseSchema = z.object({
  ...formCommonShape,
  eventQuery: z.string(),
  eventOptions: z.array(UnslottedEventOptionSchema),
  ...pagingShape,
});

export type EntryEvent = z.infer<typeof EntryEventSchema>;
export type EntryReservedSlot = z.infer<typeof EntryReservedSlotSchema>;
export type EntryIndexResponse = z.infer<typeof EntryIndexResponseSchema>;
export type EntryCustomQuestion = z.infer<typeof EntryCustomQuestionSchema>;
export type EntrySubmitBlock = z.infer<typeof EntrySubmitBlockSchema>;
export type EntryInitialProfile = z.infer<typeof EntryInitialProfileSchema>;
export type EntryXIdOption = z.infer<typeof EntryXIdOptionSchema>;
export type SlottedEventOption = z.infer<typeof SlottedEventOptionSchema>;
export type UnslottedEventOption = z.infer<typeof UnslottedEventOptionSchema>;
export type SlottedEntryResponse = z.infer<typeof SlottedEntryResponseSchema>;
export type UnslottedEntryResponse = z.infer<typeof UnslottedEntryResponseSchema>;
