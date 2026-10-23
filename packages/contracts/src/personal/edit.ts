import { z } from "zod";
import { SlottedEventOptionSchema } from "./entry.ts";
import { PersonalUserSchema } from "./shared.ts";

// MIG-0630: DTOs for the authenticated video-edit read APIs (/api/personal/edit/:id and /:id/permissions).
// CURRENT sources: app/(auth)/dashboard/edit/[id]/page.tsx and permissions/page.tsx (loader part only). Unit U02a
// returns the access decision and the form's own values; event options / custom questions / answers / suggestions are unit U02b
// (EditFormOptionsResponseSchema below). The Japanese messages, the permission view model and the mode-switch links stay in the UI (the
// inputs for them are returned here).

export const EditPrivilegeModeSchema = z.enum(["normal", "admin", "event"]);

export const EditOwnershipSchema = z.object({
  isCreatorOwner: z.boolean(),
  isCollaboratorOwner: z.boolean(),
  isOwner: z.boolean(),
});

/** buildVideoEditPermissionViewModel `sections` (the editable flag of each view section). */
export const EditSectionsSchema = z.object({
  identity: z.boolean(),
  basics: z.boolean(),
  youtube: z.boolean(),
  credits: z.boolean(),
  descriptions: z.boolean(),
  members: z.boolean(),
  memberChapters: z.boolean(),
  primaryEvent: z.boolean(),
  visibility: z.boolean(),
  permissions: z.boolean(),
});

export const EditAccessSchema = z.object({
  privilegeMode: EditPrivilegeModeSchema,
  ownership: EditOwnershipSchema,
  canOfferAdminMode: z.boolean(),
  canOfferEventMode: z.boolean(),
  membershipHint: z.enum(["none", "member_no_edit", "outsider"]),
  sections: EditSectionsSchema,
  /** event mode only (null otherwise): the event that grants each section; eventTitle null when the event row is missing. */
  sectionEventSources: z
    .record(z.object({ eventId: z.string(), eventTitle: z.string().nullable() }))
    .nullable(),
  /** view model `eventId` / `eventTitle` input (event mode only). */
  eventId: z.string().nullable(),
  eventTitleForMode: z.string().nullable(),
  /** hasAnyEditableVideoFormSection(permissionView): any of the 8 form sections is editable. */
  canEditAnySection: z.boolean(),
});

/** resolveNoAccessMessage / resolveSwitchOnlyMessage as a code (the sentence stays in the UI). */
export const EditNoticeSchema = z.enum([
  "switch_admin",
  "switch_event",
  "event_staff_insufficient",
  "owner_policy_denied",
  "not_editable",
]);

export const EditVideoHeaderSchema = z.object({
  id: z.string(),
  title: z.string(),
  visibility_status: z.string(),
  /** trimmed youtube_video_id or null */
  youtube_video_id: z.string().nullable(),
});

export const EditMemberSchema = z.object({
  name: z.string(),
  x_user_id: z.string(),
  role: z.string(),
  comment: z.string(),
  can_edit: z.number(),
  is_public_member: z.number(),
});

export const EditCollabSummarySchema = z.object({
  editorCount: z.number(),
  unlinkedEditorCount: z.number(),
  notifiableEditorCount: z.number(),
  displayNames: z.string(),
  warnings: z.array(z.object({ tone: z.enum(["warning", "info"]), title: z.string(), detail: z.string().optional() })),
});

const nullableString = z.string().nullable();

export const EditVideoValuesSchema = EditVideoHeaderSchema.extend({
  updated_at: z.number(),
  scheduling_type: nullableString,
  collaboration_type: z.string(),
  primary_event_id: nullableString,
  part: nullableString,
  creator_display_name: nullableString,
  creator_x_user_id: nullableString,
  creator_icon_url: nullableString,
  creator_profile_text: nullableString,
  creator_youtube_channel_url: nullableString,
  creator_other_social_links: nullableString,
  music: nullableString,
  music_reference_url: nullableString,
  credit: nullableString,
  intro_comment: nullableString,
  highlights: nullableString,
  production_story: nullableString,
  closing_comment: nullableString,
});

/** Response bound shared by the members list and the collab subject list (see `truncated` fields). */
export const EditEventTitleSchema = z.object({ id: z.string(), title: z.string() });

export const EditDefaultProfileSchema = z.object({
  display_name: z.string(),
  icon_url: nullableString,
  profile_text: nullableString,
  youtube_channel_url: nullableString,
  other_social_links: nullableString,
});

/**
 * GET /api/personal/edit/:id?privileged=admin|event.
 * - 404 `{error:"not_found"}`: no such video (CURRENT notFound()).
 * - `no_access`: CURRENT's "編集権限がありません" panel; carries nothing but the public link target.
 * - `switch_only`: header + permission overview without the form.
 */
export const EditPageResponseSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("no_access"),
    message: EditNoticeSchema,
    /** CURRENT links to `/${youtube_video_id ?? id}`. */
    public_id: z.string(),
  }),
  z.object({
    kind: z.literal("switch_only"),
    user: PersonalUserSchema,
    video: EditVideoHeaderSchema,
    access: EditAccessSchema,
    message: EditNoticeSchema,
    events: z.array(EditEventTitleSchema),
  }),
  z.object({
    kind: z.literal("edit"),
    user: PersonalUserSchema,
    video: EditVideoValuesSchema,
    access: EditAccessSchema,
    disabledSections: z.array(z.string()),
    disabledFields: z.array(z.string()),
    canEditEvents: z.boolean(),
    canChangeSubmitter: z.boolean(),
    defaultProfile: EditDefaultProfileSchema.nullable(),
    softwareLabel: nullableString,
    isCollab: z.boolean(),
    /** page `currentEventIds` (video_events order by event_id, then the primary event when missing) */
    eventIds: z.array(z.string()),
    /** titles of the attached events (CURRENT eventTitleById input); rows missing from `events` are omitted */
    events: z.array(EditEventTitleSchema),
    members: z.array(EditMemberSchema),
    /** true when the public member list was cut (100 rows / 64 KiB): the SPA must not save members from it. */
    membersTruncated: z.boolean(),
    xIdOptions: z.array(z.object({ id: z.string(), x_name: z.string() })),
    /** computeEditPermissionSummary; null unless CURRENT renders VideoEditPermissionSummary. */
    permissionSummary: EditCollabSummarySchema.nullable(),
    /** the collab subject rows were cut at 100: the summary counts cover the first 100 only. */
    collabTruncated: z.boolean(),
  }),
]);

export const EditCollabSubjectSchema = z.object({
  x_user_id: z.string(),
  user_id: z.null(),
  display_name: z.string(),
  can_edit: z.number(),
  is_public_member: z.number(),
  has_discord_link: z.boolean(),
  can_notify: z.boolean(),
});

export const EditPublicMemberCandidateSchema = z.object({
  x_user_id: nullableString,
  display_name: z.string(),
  role: nullableString,
  can_edit: z.number(),
});

/** GET /api/personal/edit/:id/permissions?privileged=admin|event. 404 `{error:"not_found"}` when no such video. */
export const EditPermissionsResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("no_access"), privilegeMode: EditPrivilegeModeSchema }),
  z.object({
    kind: z.literal("ok"),
    privilegeMode: EditPrivilegeModeSchema,
    video: z.object({
      id: z.string(),
      title: z.string(),
      youtube_video_id: nullableString,
      collaboration_type: z.string(),
    }),
    /** CURRENT: collab type or at least one subject (tableAvailable is always true on D1) */
    showCollabSection: z.boolean(),
    subjects: z.array(EditCollabSubjectSchema),
    publicMembers: z.array(EditPublicMemberCandidateSchema),
    /** subjects / publicMembers were cut (100 rows / 64 KiB): the SPA must not save permissions from a cut list. */
    truncated: z.boolean(),
  }),
]);

/**
 * GET /api/personal/edit/:id/form-options?privileged=&offset=N (MIG-0630 U02b): what the CURRENT edit page loads for VideoForm
 * besides the video's own values (those are in GET /api/personal/edit/:id). `no_access` = the page would not render the form
 * (no capability, or only a privilege switch); nothing else is returned. 404 `{error:"not_found"}` for an unknown video.
 * `eventOptions` is paged like the Entry forms: `truncated` = more accepting events may follow, `nextOffset` = the `?offset=`
 * that continues (null when complete or beyond the 900 clamp). The events the video is attached to are listed first on the
 * first page (offset 0); a later page may repeat one of them at its natural place (merge by id). `youtube_description_event_url`
 * is derived by the UI from the id (`/event/<id>`). `customAnswers` is CURRENT initialCustomAnswers (`<event_id>:<question_key>`),
 * `stagePermissionAnswers` is CURRENT stagePermissionInitial (custom_question_answers_json). When `customAnswersTruncated` the
 * answers are incomplete and the SPA must not save them.
 */
export const EditFormOptionsResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("no_access") }),
  z.object({
    kind: z.literal("ready"),
    eventOptions: z.array(SlottedEventOptionSchema),
    truncated: z.boolean(),
    nextOffset: z.number().nullable(),
    customAnswers: z.record(z.union([z.string(), z.array(z.string())])),
    customAnswersTruncated: z.boolean(),
    stagePermissionAnswers: z.string().nullable(),
    softwareSuggestions: z.array(z.string()),
    iconCandidates: z.array(z.string()),
    channelCandidates: z.array(z.string()),
  }),
]);

export type EditFormOptionsResponse = z.infer<typeof EditFormOptionsResponseSchema>;
export type EditAccess = z.infer<typeof EditAccessSchema>;
export type EditSections = z.infer<typeof EditSectionsSchema>;
export type EditNotice = z.infer<typeof EditNoticeSchema>;
export type EditMember = z.infer<typeof EditMemberSchema>;
export type EditCollabSummary = z.infer<typeof EditCollabSummarySchema>;
export type EditPageResponse = z.infer<typeof EditPageResponseSchema>;
export type EditCollabSubject = z.infer<typeof EditCollabSubjectSchema>;
export type EditPublicMemberCandidate = z.infer<typeof EditPublicMemberCandidateSchema>;
export type EditPermissionsResponse = z.infer<typeof EditPermissionsResponseSchema>;
