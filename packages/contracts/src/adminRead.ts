import { z } from "zod";

// MIG-0625: DTOs of the read-only Admin API (users / videos / events / moderation / x-id / event groups).
// Every field mirrors what CURRENT app/(admin)/admin/** pages render. GET only, Cache-Control: private, no-store.
// Zod schemas are the source of truth; the TS types are z.infer of them.

const nullableString = z.string().nullable();
const nullableNumber = z.number().nullable();

/** 401 -> SPA redirects to /entry, 403 redirect -> /dashboard (CURRENT (admin)/layout.tsx), 503 -> "unavailable". */
export const AdminReadErrorSchema = z.object({
  error: z.string(),
  redirect: z.string().optional(),
});
export type AdminReadError = z.infer<typeof AdminReadErrorSchema>;

export const AdminPagingSchema = z.object({
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
});
export type AdminPaging = z.infer<typeof AdminPagingSchema>;

// ---- /users -------------------------------------------------------------------------------------------------

export const AdminUsersViewSchema = z.enum(["discord", "xid", "permissions"]);
export type AdminUsersView = z.infer<typeof AdminUsersViewSchema>;

export const AdminUserRowSchema = z.object({
  id: z.string(),
  name: nullableString,
  image: nullableString,
  role: z.enum(["user", "admin", "moderator"]).nullable(),
  is_banned: nullableNumber,
  can_create_events: nullableNumber,
  active_x_user_id: nullableString,
  active_x_name: nullableString,
  created_at: z.number(),
});
export type AdminUserRow = z.infer<typeof AdminUserRowSchema>;

export const AdminXUserRowSchema = z.object({
  id: z.string(),
  x_name: z.string(),
  /** CURRENT resolves this from the R2 public icon map; not reproduced yet (always null, see MIG-0625 handoff). */
  icon_url: nullableString,
  approval_status: z.enum(["pending", "approved", "rejected", "imported"]).nullable(),
  primary_auth_user_id: nullableString,
  primary_auth_user_name: nullableString,
  linked_auth_user_count: z.number(),
  active_holder_count: z.number(),
});
export type AdminXUserRow = z.infer<typeof AdminXUserRowSchema>;

export const AdminPermissionSettingsSchema = z.object({
  default_editable_fields: nullableString,
  upcoming_editable_fields: nullableString,
});
export type AdminPermissionSettings = z.infer<typeof AdminPermissionSettingsSchema>;

export const AdminUsersResponseSchema = z.object({
  view: AdminUsersViewSchema,
  q: z.string(),
  status: z.string(),
  paging: AdminPagingSchema,
  users: z.array(AdminUserRowSchema),
  xUsers: z.array(AdminXUserRowSchema),
  permissionSettings: AdminPermissionSettingsSchema,
  /** true when the D1 read failed (CURRENT logs and renders the empty page). */
  degraded: z.boolean(),
});
export type AdminUsersResponse = z.infer<typeof AdminUsersResponseSchema>;

/** view=links redirects to /admin/x-link-requests in CURRENT. */
export const AdminUsersRedirectResponseSchema = z.object({ redirect: z.string() });
export type AdminUsersRedirectResponse = z.infer<typeof AdminUsersRedirectResponseSchema>;

export const AdminUserDetailXIdSchema = z.object({
  id: z.string(),
  x_name: z.string(),
  icon_url: nullableString,
  approval_status: nullableString,
});
export type AdminUserDetailXId = z.infer<typeof AdminUserDetailXIdSchema>;

export const AdminUserDetailVideoSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  created_at: z.number(),
});
export type AdminUserDetailVideo = z.infer<typeof AdminUserDetailVideoSchema>;

export const AdminUserDetailLinkRequestSchema = z.object({
  id: z.string(),
  requested_x_id: nullableString,
  link_type: nullableString,
  target_x_user_id: nullableString,
  status: nullableString,
  requested_at: z.number(),
});
export type AdminUserDetailLinkRequest = z.infer<typeof AdminUserDetailLinkRequestSchema>;

export const AdminUserDetailAuditRowSchema = z.object({
  id: z.string(),
  created_at: z.number(),
  table_name: z.string(),
  operation: z.string(),
  actor_user_id: nullableString,
  target_id: nullableString,
});
export type AdminUserDetailAuditRow = z.infer<typeof AdminUserDetailAuditRowSchema>;

export const AdminUserDetailResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    name: nullableString,
    email: nullableString,
    /** epoch milliseconds (CURRENT reads a Date from the Auth.js timestamp_ms column) */
    emailVerified: nullableNumber,
    discord_id: nullableString,
    role: nullableString,
    can_create_events: nullableNumber,
    is_tos_accepted: nullableNumber,
    terms_reaccept_required: z.union([z.literal(0), z.literal(1)]),
    is_banned: nullableNumber,
    is_notification_enabled: nullableNumber,
    active_x_user_id: nullableString,
    created_at: z.number(),
  }),
  xIds: z.array(AdminUserDetailXIdSchema),
  recentVideos: z.array(AdminUserDetailVideoSchema),
  recentByOperator: z.array(AdminUserDetailAuditRowSchema),
  recentOnUser: z.array(AdminUserDetailAuditRowSchema),
  likeCount: z.number(),
  bookmarkCount: z.number(),
  linkRequests: z.array(AdminUserDetailLinkRequestSchema),
});
export type AdminUserDetailResponse = z.infer<typeof AdminUserDetailResponseSchema>;

// ---- /videos ------------------------------------------------------------------------------------------------

export const AdminVideoRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  source_type: z.string(),
  youtube_video_id: nullableString,
  display_name: nullableString,
  status: z.string(),
  created_at: z.number(),
  /** review group only (status review|pending): CURRENT fetchVideoReviewSummaries */
  review: z
    .object({ stage_permission_summary: z.string(), required_unanswered_count: z.number() })
    .optional(),
});
export type AdminVideoRow = z.infer<typeof AdminVideoRowSchema>;

export const AdminVideosResponseSchema = z.object({
  q: z.string(),
  /** normalized visibility filter ("" | pending | public | private | voided | review | closed) */
  status: z.string(),
  event: z.string(),
  paging: AdminPagingSchema,
  videos: z.array(AdminVideoRowSchema),
  events: z.array(z.object({ id: z.string(), title: z.string() })),
  /**
   * The review group per-row stage-permission / unanswered counts (CURRENT fetchVideoReviewSummaries) are not
   * reproduced yet; the SPA shows a dash and 0 until the follow-up lands (MIG-0625 handoff).
   */
  reviewSummaries: z.enum(["included", "not_requested"]),
  degraded: z.boolean(),
});
export type AdminVideosResponse = z.infer<typeof AdminVideosResponseSchema>;

// ---- /events ------------------------------------------------------------------------------------------------

export const AdminEventSortSchema = z.enum(["newest", "oldest", "upcoming"]);
export type AdminEventSort = z.infer<typeof AdminEventSortSchema>;
export const AdminEventFilterSchema = z.enum(["all", "public", "private", "accepting"]);
export type AdminEventFilter = z.infer<typeof AdminEventFilterSchema>;

export const AdminEventRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  visibility_status: z.string(),
  start_time: nullableNumber,
  end_time: nullableNumber,
  entry_start_time: nullableNumber,
  entry_end_time: nullableNumber,
});
export type AdminEventRow = z.infer<typeof AdminEventRowSchema>;

export const AdminEventsResponseSchema = z.object({
  sort: AdminEventSortSchema,
  filter: AdminEventFilterSchema,
  q: z.string(),
  /** server unix seconds used for the accepting-entries SQL; the SPA computes the badges against the same instant */
  now: z.number(),
  events: z.array(AdminEventRowSchema),
});
export type AdminEventsResponse = z.infer<typeof AdminEventsResponseSchema>;

// ---- /moderation --------------------------------------------------------------------------------------------

export const AdminModerationRowSchema = z.object({
  id: z.string(),
  video_id: z.string(),
  case_type: z.string(),
  status: z.string(),
  public_reason: nullableString,
  private_note: nullableString,
  due_at: nullableNumber,
  locked_until: nullableNumber,
  attempt_count: z.number(),
  related_x_user_id: nullableString,
  created_by_user_id: nullableString,
  resolved_by_user_id: nullableString,
  created_at: z.number(),
  resolved_at: nullableNumber,
  video_title: nullableString,
  video_status: nullableString,
  related_x_name: nullableString,
});
export type AdminModerationRow = z.infer<typeof AdminModerationRowSchema>;

export const AdminModerationResponseSchema = z.object({
  type: z.string(),
  status: z.string(),
  overdue: z.boolean(),
  now: z.number(),
  cases: z.array(AdminModerationRowSchema),
});
export type AdminModerationResponse = z.infer<typeof AdminModerationResponseSchema>;

// ---- /x-link-requests ---------------------------------------------------------------------------------------

export const AdminXLinkRequestRowSchema = z.object({
  id: z.string(),
  requested_x_id: z.string(),
  requested_by_auth_user_id: z.string(),
  discord_name: nullableString,
  discord_image: nullableString,
  requested_at: z.number(),
  request_type: z.string(),
  target_x_user_id: nullableString,
  requested_x_name: nullableString,
  /** CURRENT resolveManageXIconUrl: external https as is, approved internal icons signed (5 min), else null */
  requested_icon_url: nullableString,
  requested_approval_status: nullableString,
  target_icon_url: nullableString,
  target_approval_status: nullableString,
});
export type AdminXLinkRequestRow = z.infer<typeof AdminXLinkRequestRowSchema>;

export const AdminXLinkRejectedRowSchema = z.object({
  id: z.string(),
  requested_x_id: nullableString,
  requested_by_auth_user_id: z.string(),
  request_type: z.string(),
  requested_at: z.number(),
});
export type AdminXLinkRejectedRow = z.infer<typeof AdminXLinkRejectedRowSchema>;

export const AdminXLinkAuditRowSchema = z.object({
  id: z.string(),
  table_name: z.string(),
  operation: z.string(),
  target_id: nullableString,
  created_at: z.number(),
  /** CURRENT parseAuditDiff(before, after).changedKeys.slice(0, 6) */
  changedKeys: z.array(z.string()),
});
export type AdminXLinkAuditRow = z.infer<typeof AdminXLinkAuditRowSchema>;

export const AdminXLinkRequestsResponseSchema = z.object({
  pending: z.array(AdminXLinkRequestRowSchema),
  recentRejected: z.array(AdminXLinkRejectedRowSchema),
  recentAudit: z.array(AdminXLinkAuditRowSchema),
});
export type AdminXLinkRequestsResponse = z.infer<typeof AdminXLinkRequestsResponseSchema>;

// ---- /x-id-merges -------------------------------------------------------------------------------------------

export const AdminXMergeImpactItemSchema = z.object({
  key: z.string(),
  label: z.string(),
  count: z.number(),
});
export type AdminXMergeImpactItem = z.infer<typeof AdminXMergeImpactItemSchema>;

export const AdminXMergePreviewRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  visibility_status: z.string(),
  primary_event_id: nullableString,
  creator_change: z.number(),
  member_rows: z.number(),
  chapter_rows: z.number(),
  slot_rows: z.number(),
  interaction_rows: z.number(),
  moderation_rows: z.number(),
});
export type AdminXMergePreviewRow = z.infer<typeof AdminXMergePreviewRowSchema>;

export const AdminXMergeRequestRowSchema = z.object({
  id: z.string(),
  request_type: z.string(),
  status: z.string(),
  source_x_user_id: nullableString,
  target_x_user_id: nullableString,
  parent_request_id: nullableString,
  revert_deadline_at: nullableNumber,
  updated_at: z.number(),
  source_name: nullableString,
  target_name: nullableString,
  /** CURRENT never renders the restore JSON, only whether it exists */
  has_restore_snapshot: z.boolean(),
  /** only for the request selected with the impact query (pending/approved), else [] */
  impact: z.array(AdminXMergeImpactItemSchema),
  preview: z.array(AdminXMergePreviewRowSchema),
});
export type AdminXMergeRequestRow = z.infer<typeof AdminXMergeRequestRowSchema>;

export const AdminXMergeRevertRowSchema = z.object({
  id: z.string(),
  status: z.string(),
  parent_request_id: nullableString,
  revert_deadline_at: nullableNumber,
  has_restore_snapshot: z.boolean(),
});
export type AdminXMergeRevertRow = z.infer<typeof AdminXMergeRevertRowSchema>;

export const AdminXIdMergesResponseSchema = z.object({
  view: z.enum(["requests", "reverts"]),
  selectedImpactId: z.string(),
  requests: z.array(AdminXMergeRequestRowSchema),
  reverts: z.array(AdminXMergeRevertRowSchema),
  /** server unix seconds, for the expired badges */
  now: z.number(),
});
export type AdminXIdMergesResponse = z.infer<typeof AdminXIdMergesResponseSchema>;

// ---- /events/templates and /events/new ----------------------------------------------------------------------

export const AdminEventTemplateRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: nullableString,
  source_event_id: nullableString,
  updated_at: z.number(),
});
export type AdminEventTemplateRow = z.infer<typeof AdminEventTemplateRowSchema>;

/**
 * CURRENT listEventTemplatesForAdmin runs behind requireAdminWrite admin_event_templates: a denied guard
 * (TOS not accepted, re-accept required, cost guard) renders the page with an EMPTY list. guardOk is false then.
 */
export const AdminEventTemplatesResponseSchema = z.object({
  guardOk: z.boolean(),
  templates: z.array(AdminEventTemplateRowSchema),
});
export type AdminEventTemplatesResponse = z.infer<typeof AdminEventTemplatesResponseSchema>;

export const AdminEventNewResponseSchema = AdminEventTemplatesResponseSchema.extend({
  /** the signed-in admin (EventForm draftAuthUserId) */
  userId: z.string(),
  templateId: z.string(),
  templateName: nullableString,
  /** raw event_templates.settings_json (max 64 KiB, else null); snapshotToFormInitial is not ported yet */
  templateSettingsJson: nullableString,
  formInitial: z.literal("deferred"),
});
export type AdminEventNewResponse = z.infer<typeof AdminEventNewResponseSchema>;

// ---- /event-groups ------------------------------------------------------------------------------------------

export const AdminEventGroupRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  group_type: z.string(),
  visibility_status: z.string(),
  sort_order: nullableNumber,
  event_count: z.number(),
});
export type AdminEventGroupRow = z.infer<typeof AdminEventGroupRowSchema>;

export const AdminEventGroupsResponseSchema = z.object({
  visibility: z.string(),
  type: z.string(),
  groups: z.array(AdminEventGroupRowSchema),
});
export type AdminEventGroupsResponse = z.infer<typeof AdminEventGroupsResponseSchema>;

export const AdminEventGroupMemberSchema = z.object({
  event_id: z.string(),
  title: z.string(),
  start_time: nullableNumber,
});
export type AdminEventGroupMember = z.infer<typeof AdminEventGroupMemberSchema>;

export const AdminEventGroupDetailResponseSchema = z.object({
  group: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    description: nullableString,
    group_type: z.string(),
    icon_url: nullableString,
    accent_color: nullableString,
    visibility_status: z.string(),
    sort_order: nullableNumber,
    updated_at: z.number(),
  }),
  members: z.array(AdminEventGroupMemberSchema),
  /** CURRENT queryEventGroupEventOptions with empty query and null cursor: first page of events not in the group */
  eventOptions: z.array(z.object({ id: z.string(), title: z.string(), start_time: nullableNumber })),
  nextCursor: nullableString,
});
export type AdminEventGroupDetailResponse = z.infer<typeof AdminEventGroupDetailResponseSchema>;

// ---- /videos/:id (MIG-0635) ----------------------------------------------------------------------------------

export const AdminVideoDetailCustomAnswerSchema = z.object({
  label: z.string(),
  required: z.boolean(),
  answer: z.string(),
});
export type AdminVideoDetailCustomAnswer = z.infer<typeof AdminVideoDetailCustomAnswerSchema>;

export const AdminVideoDetailMemberSchema = z.object({
  name: z.string(),
  role: nullableString,
  x_user_id: nullableString,
  is_public_member: z.boolean(),
  chapters: nullableString,
});
export type AdminVideoDetailMember = z.infer<typeof AdminVideoDetailMemberSchema>;

export const AdminVideoDetailReviewVideoSchema = z.object({
  id: z.string(),
  title: z.string(),
  creator_name: z.string(),
  creator_x_user_id: nullableString,
  created_at: z.number(),
  source_type: z.string(),
  youtube_video_id: nullableString,
  music: nullableString,
  credit: nullableString,
  intro_comment: nullableString,
  highlights: nullableString,
  production_story: nullableString,
  stagePermission: nullableString,
  visibility_status: z.string(),
  software_label: nullableString,
  event_ids: z.array(z.string()),
  customAnswers: z.array(AdminVideoDetailCustomAnswerSchema),
  members: z.array(AdminVideoDetailMemberSchema),
});
export type AdminVideoDetailReviewVideo = z.infer<typeof AdminVideoDetailReviewVideoSchema>;

export const AdminVideoModerationCaseSchema = z.object({
  id: z.string(),
  case_type: z.string(),
  status: z.string(),
  public_reason: nullableString,
  private_note: nullableString,
  due_at: nullableNumber,
  related_x_user_id: nullableString,
  created_at: z.number(),
  resolved_at: nullableNumber,
});
export type AdminVideoModerationCase = z.infer<typeof AdminVideoModerationCaseSchema>;

export const AdminVideoDetailResponseSchema = z.object({
  video: AdminVideoDetailReviewVideoSchema,
  moderationCases: z.array(AdminVideoModerationCaseSchema),
  openCaseCount: z.number(),
  openVoidCaseId: nullableString,
  event: nullableString,
  truncated: z.boolean(),
});
export type AdminVideoDetailResponse = z.infer<typeof AdminVideoDetailResponseSchema>;

// ---- /videos/:id/members (MIG-0635) --------------------------------------------------------------------------

export const AdminVideoMemberChapterInputSchema = z.object({
  time: z.string(),
  label: z.string(),
  note: z.string(),
});
export type AdminVideoMemberChapterInput = z.infer<typeof AdminVideoMemberChapterInputSchema>;

export const AdminVideoMemberInputSchema = z.object({
  name: z.string(),
  x_user_id: z.string(),
  role: z.string(),
  comment: z.string(),
  order_index: z.number(),
  can_edit: z.number(),
  is_public_member: z.number(),
  chapters: z.array(AdminVideoMemberChapterInputSchema),
});
export type AdminVideoMemberInput = z.infer<typeof AdminVideoMemberInputSchema>;

export const AdminVideoMembersResponseSchema = z.object({
  video: z.object({
    id: z.string(),
    title: z.string(),
    youtube_video_id: nullableString,
    collaboration_type: nullableString,
  }),
  initialMembers: z.array(AdminVideoMemberInputSchema),
});
export type AdminVideoMembersResponse = z.infer<typeof AdminVideoMembersResponseSchema>;

// ---- /users/:id/edit (MIG-0635) -----------------------------------------------------------------------------

export const AdminUserEditResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    name: nullableString,
    role: z.enum(["user", "admin", "moderator"]),
    is_banned: z.number(),
    can_create_events: z.number(),
    is_notification_enabled: z.number(),
  }),
  xUserIds: z.array(z.string()),
});
export type AdminUserEditResponse = z.infer<typeof AdminUserEditResponseSchema>;
