// MIG-0625: DTOs of the read-only Admin API (users / videos / events / moderation).
// Every field mirrors what CURRENT app/(admin)/admin/** pages render. GET only, `Cache-Control: private, no-store`.

/** 401 -> SPA redirects to /entry, 403 `redirect` -> /dashboard (CURRENT (admin)/layout.tsx), 503 -> "unavailable". */
export interface AdminReadError {
  error: string;
  redirect?: string;
}

export interface AdminPaging {
  page: number;
  pageSize: number;
  total: number;
}

// ---- /users -------------------------------------------------------------------------------------------------

export type AdminUsersView = "discord" | "xid" | "permissions";

export interface AdminUserRow {
  id: string;
  name: string | null;
  image: string | null;
  role: "user" | "admin" | "moderator" | null;
  is_banned: number | null;
  can_create_events: number | null;
  active_x_user_id: string | null;
  active_x_name: string | null;
  created_at: number;
}

export interface AdminXUserRow {
  id: string;
  x_name: string;
  /** CURRENT resolves this from the R2 public icon map; not reproduced yet (always null, see MIG-0625 handoff). */
  icon_url: string | null;
  approval_status: "pending" | "approved" | "rejected" | "imported" | null;
  primary_auth_user_id: string | null;
  primary_auth_user_name: string | null;
  linked_auth_user_count: number;
  active_holder_count: number;
}

export interface AdminPermissionSettings {
  default_editable_fields: string | null;
  upcoming_editable_fields: string | null;
}

export interface AdminUsersResponse {
  view: AdminUsersView;
  q: string;
  status: string;
  paging: AdminPaging;
  users: AdminUserRow[];
  xUsers: AdminXUserRow[];
  permissionSettings: AdminPermissionSettings;
  /** true when the D1 read failed (CURRENT logs and renders the empty page). */
  degraded: boolean;
}

/** `?view=links` redirects to /admin/x-link-requests in CURRENT. */
export interface AdminUsersRedirectResponse {
  redirect: string;
}

export interface AdminUserDetailXId {
  id: string;
  x_name: string;
  icon_url: string | null;
  approval_status: string | null;
}

export interface AdminUserDetailVideo {
  id: string;
  title: string;
  status: string;
  created_at: number;
}

export interface AdminUserDetailLinkRequest {
  id: string;
  requested_x_id: string | null;
  link_type: string | null;
  target_x_user_id: string | null;
  status: string | null;
  requested_at: number;
}

export interface AdminUserDetailAuditRow {
  id: string;
  created_at: number;
  table_name: string;
  operation: string;
  actor_user_id: string | null;
  target_id: string | null;
}

export interface AdminUserDetailResponse {
  user: {
    id: string;
    name: string | null;
    email: string | null;
    /** epoch milliseconds (CURRENT reads a Date from the Auth.js timestamp_ms column) */
    emailVerified: number | null;
    discord_id: string | null;
    role: string | null;
    can_create_events: number | null;
    is_tos_accepted: number | null;
    terms_reaccept_required: 0 | 1;
    is_banned: number | null;
    is_notification_enabled: number | null;
    active_x_user_id: string | null;
    created_at: number;
  };
  xIds: AdminUserDetailXId[];
  recentVideos: AdminUserDetailVideo[];
  recentByOperator: AdminUserDetailAuditRow[];
  recentOnUser: AdminUserDetailAuditRow[];
  likeCount: number;
  bookmarkCount: number;
  linkRequests: AdminUserDetailLinkRequest[];
}

// ---- /videos ------------------------------------------------------------------------------------------------

export interface AdminVideoRow {
  id: string;
  title: string;
  source_type: string;
  youtube_video_id: string | null;
  display_name: string | null;
  status: string;
  created_at: number;
}

export interface AdminVideosResponse {
  q: string;
  /** normalized visibility filter ("" | pending | public | private | voided | review | closed) */
  status: string;
  event: string;
  paging: AdminPaging;
  videos: AdminVideoRow[];
  events: { id: string; title: string }[];
  /**
   * The review group's per-row stage-permission / unanswered counts (CURRENT fetchVideoReviewSummaries) are not
   * reproduced yet; the SPA shows "-" / 0 until the follow-up lands (MIG-0625 handoff).
   */
  reviewSummaries: "deferred";
  degraded: boolean;
}

// ---- /events ------------------------------------------------------------------------------------------------

export type AdminEventSort = "newest" | "oldest" | "upcoming";
export type AdminEventFilter = "all" | "public" | "private" | "accepting";

export interface AdminEventRow {
  id: string;
  title: string;
  visibility_status: string;
  start_time: number | null;
  end_time: number | null;
  entry_start_time: number | null;
  entry_end_time: number | null;
}

export interface AdminEventsResponse {
  sort: AdminEventSort;
  filter: AdminEventFilter;
  q: string;
  /** server unix seconds used for the accepting-entries SQL; the SPA computes the badges against the same instant */
  now: number;
  events: AdminEventRow[];
}

// ---- /moderation --------------------------------------------------------------------------------------------

export interface AdminModerationRow {
  id: string;
  video_id: string;
  case_type: string;
  status: string;
  public_reason: string | null;
  private_note: string | null;
  due_at: number | null;
  locked_until: number | null;
  attempt_count: number;
  related_x_user_id: string | null;
  created_by_user_id: string | null;
  resolved_by_user_id: string | null;
  created_at: number;
  resolved_at: number | null;
  video_title: string | null;
  video_status: string | null;
  related_x_name: string | null;
}

export interface AdminModerationResponse {
  type: string;
  status: string;
  overdue: boolean;
  now: number;
  cases: AdminModerationRow[];
}

// ---- /x-link-requests ---------------------------------------------------------------------------------------

export interface AdminXLinkRequestRow {
  id: string;
  requested_x_id: string;
  requested_by_auth_user_id: string;
  discord_name: string | null;
  discord_image: string | null;
  requested_at: number;
  request_type: string;
  target_x_user_id: string | null;
  requested_x_name: string | null;
  /** CURRENT resolveManageXIconUrl: external https as is, approved internal icons signed (5 min), else null */
  requested_icon_url: string | null;
  requested_approval_status: string | null;
  target_icon_url: string | null;
  target_approval_status: string | null;
}

export interface AdminXLinkRejectedRow {
  id: string;
  requested_x_id: string | null;
  requested_by_auth_user_id: string;
  request_type: string;
  requested_at: number;
}

export interface AdminXLinkAuditRow {
  id: string;
  table_name: string;
  operation: string;
  target_id: string | null;
  created_at: number;
  /** CURRENT parseAuditDiff(before, after).changedKeys.slice(0, 6) */
  changedKeys: string[];
}

export interface AdminXLinkRequestsResponse {
  pending: AdminXLinkRequestRow[];
  recentRejected: AdminXLinkRejectedRow[];
  recentAudit: AdminXLinkAuditRow[];
}

// ---- /x-id-merges -------------------------------------------------------------------------------------------

export interface AdminXMergeImpactItem {
  key: string;
  label: string;
  count: number;
}

export interface AdminXMergePreviewRow {
  id: string;
  title: string;
  visibility_status: string;
  primary_event_id: string | null;
  creator_change: number;
  member_rows: number;
  chapter_rows: number;
  slot_rows: number;
  interaction_rows: number;
  moderation_rows: number;
}

export interface AdminXMergeRequestRow {
  id: string;
  request_type: string;
  status: string;
  source_x_user_id: string | null;
  target_x_user_id: string | null;
  parent_request_id: string | null;
  revert_deadline_at: number | null;
  updated_at: number;
  source_name: string | null;
  target_name: string | null;
  /** CURRENT never renders the restore JSON, only whether it exists */
  has_restore_snapshot: boolean;
  /** only for the request selected with ?impact= (pending/approved), else [] */
  impact: AdminXMergeImpactItem[];
  preview: AdminXMergePreviewRow[];
}

export interface AdminXMergeRevertRow {
  id: string;
  status: string;
  parent_request_id: string | null;
  revert_deadline_at: number | null;
  has_restore_snapshot: boolean;
}

// ---- /events/templates and /events/new ----------------------------------------------------------------------

export interface AdminEventTemplateRow {
  id: string;
  name: string;
  description: string | null;
  source_event_id: string | null;
  updated_at: number;
}

/**
 * CURRENT listEventTemplatesForAdmin runs behind requireAdminWrite("admin_event_templates"): a denied guard
 * (TOS not accepted / re-accept required / cost guard) renders the page with an EMPTY list. `guardOk` is false then.
 */
export interface AdminEventTemplatesResponse {
  guardOk: boolean;
  templates: AdminEventTemplateRow[];
}

export interface AdminEventNewResponse extends AdminEventTemplatesResponse {
  /** the signed-in admin (EventForm draftAuthUserId) */
  userId: string;
  templateId: string;
  templateName: string | null;
  /** raw event_templates.settings_json (<= 64 KiB, else null); CURRENT's snapshotToFormInitial is not ported yet */
  templateSettingsJson: string | null;
  formInitial: "deferred";
}

// ---- /event-groups ------------------------------------------------------------------------------------------

export interface AdminEventGroupRow {
  id: string;
  name: string;
  slug: string;
  group_type: string;
  visibility_status: string;
  sort_order: number | null;
  event_count: number;
}

export interface AdminEventGroupsResponse {
  visibility: string;
  type: string;
  groups: AdminEventGroupRow[];
}

export interface AdminEventGroupMember {
  event_id: string;
  title: string;
  start_time: number | null;
}

export interface AdminEventGroupDetailResponse {
  group: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    group_type: string;
    icon_url: string | null;
    accent_color: string | null;
    visibility_status: string;
    sort_order: number | null;
    updated_at: number;
  };
  members: AdminEventGroupMember[];
  /** CURRENT queryEventGroupEventOptions(query "", cursor null): first page of events not in the group */
  eventOptions: { id: string; title: string; start_time: number | null }[];
  nextCursor: string | null;
}

export interface AdminXIdMergesResponse {
  view: "requests" | "reverts";
  selectedImpactId: string;
  requests: AdminXMergeRequestRow[];
  reverts: AdminXMergeRevertRow[];
  /** server unix seconds, for the "expired" badges */
  now: number;
}
