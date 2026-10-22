import { z } from "zod";

// MIG-0626: admin read DTOs for the screens not owned by MIG-0625 (settings / audit / ops).
// CURRENT: app/(admin)/admin/** page.tsx loaders. Each DTO carries only the columns the page renders
// (drizzle .select() rows are projected to what the JSX reads). Raw secrets are never part of a DTO.

export const AdminAnnouncementListRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  is_published: z.number().nullable(),
  publish_at: z.number().nullable(),
  expire_at: z.number().nullable(),
  updated_at: z.number(),
});
export const AdminAnnouncementListResponseSchema = z.object({
  audience: z.enum(["any", "all", "creators", "admins"]),
  status: z.enum(["any", "published", "draft"]),
  items: z.array(AdminAnnouncementListRowSchema),
});
export const AdminAnnouncementDetailSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  severity: z.string().nullable(),
  target_audience: z.string().nullable(),
  is_published: z.number().nullable(),
  publish_at: z.number().nullable(),
  expire_at: z.number().nullable(),
  updated_at: z.number(),
});
export const AdminAnnouncementDetailResponseSchema = z.object({ item: AdminAnnouncementDetailSchema });

export const AdminRuleListRowSchema = z.object({
  id: z.string(),
  version_label: z.string(),
  status: z.string().nullable(),
  severity: z.string().nullable(),
  published_at: z.number().nullable(),
  updated_at: z.number(),
});
export const AdminRulesResponseSchema = z.object({
  status: z.enum(["any", "published", "draft", "archived"]),
  items: z.array(AdminRuleListRowSchema),
  currentPublished: z.object({ id: z.string(), version_label: z.string() }).nullable(),
  reacceptRequiredCount: z.number(),
  reacceptCountIsLowerBound: z.boolean(),
});
export const AdminRuleDetailSchema = z.object({
  id: z.string(),
  version_label: z.string(),
  body_markdown: z.string(),
  severity: z.string().nullable(),
  status: z.string().nullable(),
});
export const AdminRuleDetailResponseSchema = z.object({ item: AdminRuleDetailSchema });

export const AdminEventGroupListRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  group_type: z.string(),
  visibility_status: z.string(),
  sort_order: z.number().nullable(),
  event_count: z.number(),
});
export const AdminEventGroupsResponseSchema = z.object({
  visibility: z.enum(["any", "public", "private", "archived"]),
  type: z.string(),
  items: z.array(AdminEventGroupListRowSchema),
});
export const AdminEventGroupDetailResponseSchema = z.object({
  group: z.object({
    id: z.string(),
    updated_at: z.number(),
    name: z.string(),
    slug: z.string(),
    description: z.string().nullable(),
    group_type: z.string(),
    icon_url: z.string().nullable(),
    accent_color: z.string().nullable(),
    visibility_status: z.string(),
    sort_order: z.number().nullable(),
  }),
  members: z.array(
    z.object({ event_id: z.string(), title: z.string(), start_time: z.number().nullable() }),
  ),
  eventOptions: z.object({
    options: z.array(
      z.object({ id: z.string(), title: z.string(), start_time: z.number().nullable() }),
    ),
    nextCursor: z.string().nullable(),
  }),
});

export const AdminEventTemplatesResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      source_event_id: z.string().nullable(),
      updated_at: z.number(),
    }),
  ),
  // The template picked by ?template= on the new-event page: name + raw settings_json (the SPA builds the form initial).
  selected: z.object({ id: z.string(), name: z.string(), settings_json: z.string() }).nullable(),
});

export const AdminAuditSettingsResponseSchema = z.object({
  settings: z.object({
    normal_retention_days: z.number(),
    restorable_retention_days: z.number(),
    long_audit_retention_days: z.number(),
    max_payload_bytes: z.number(),
    compact_after_days: z.number(),
  }),
});

export const AdminAuditRowSchema = z.object({
  id: z.string(),
  table_name: z.string(),
  target_id: z.string(),
  operation: z.string(),
  before_json: z.string().nullable(),
  after_json: z.string().nullable(),
  changed_keys_json: z.string().nullable(),
  inverse_patch_json: z.string().nullable(),
  actor_user_id: z.string(),
  actor_x_user_id: z.string().nullable(),
  actor_snapshot_json: z.string().nullable(),
  reason: z.string().nullable(),
  context: z.string().nullable(),
  retention_class: z.string(),
  restore_strategy: z.string(),
  restore_status: z.string(),
  restore_unavailable_reason_code: z.string().nullable(),
  restore_unavailable_message: z.string().nullable(),
  payload_size_bytes: z.number(),
  expires_at: z.number().nullable(),
  created_at: z.number(),
});
export const AdminAuditOperatorSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  active_x_user_id: z.string().nullable(),
  x_name: z.string().nullable(),
});
export const AdminAuditListResponseSchema = z.object({
  limit: z.number(),
  // true when rows were dropped to keep the response under the 64 KiB API budget (CURRENT shows all rows).
  truncated: z.boolean(),
  rows: z.array(AdminAuditRowSchema),
  operators: z.array(AdminAuditOperatorSchema),
});
export const AdminAuditNeighborSchema = z.object({ id: z.string(), created_at: z.number() });
export const AdminAuditDetailResponseSchema = z.object({
  row: AdminAuditRowSchema,
  prev: AdminAuditNeighborSchema.nullable(),
  next: AdminAuditNeighborSchema.nullable(),
});
export const AdminAuditRestoreResponseSchema = z.object({
  runs: z.array(
    z.object({
      id: z.string(),
      audit_log_id: z.string(),
      status: z.string(),
      executed_at: z.number(),
      executed_by_user_id: z.string(),
      reason: z.string(),
      error_message: z.string().nullable(),
      // CURRENT auditMap entry for audit_log_id (table_name / target_id only); null when the log is gone.
      log: z.object({ table_name: z.string(), target_id: z.string() }).nullable(),
    }),
  ),
});

export type AdminAnnouncementListResponse = z.infer<typeof AdminAnnouncementListResponseSchema>;
export type AdminAnnouncementDetailResponse = z.infer<typeof AdminAnnouncementDetailResponseSchema>;
export type AdminRulesResponse = z.infer<typeof AdminRulesResponseSchema>;
export type AdminRuleDetailResponse = z.infer<typeof AdminRuleDetailResponseSchema>;
export type AdminEventGroupsResponse = z.infer<typeof AdminEventGroupsResponseSchema>;
export type AdminEventGroupDetailResponse = z.infer<typeof AdminEventGroupDetailResponseSchema>;
export type AdminEventTemplatesResponse = z.infer<typeof AdminEventTemplatesResponseSchema>;
export type AdminAuditSettingsResponse = z.infer<typeof AdminAuditSettingsResponseSchema>;
export type AdminAuditListResponse = z.infer<typeof AdminAuditListResponseSchema>;
export type AdminAuditDetailResponse = z.infer<typeof AdminAuditDetailResponseSchema>;
export type AdminAuditRestoreResponse = z.infer<typeof AdminAuditRestoreResponseSchema>;

// ---- ops: notifications / YouTube sync ----

export const AdminNotificationRowSchema = z.object({
  id: z.string(),
  type: z.string(),
  status: z.string().nullable(),
  payload_json: z.string(),
  event_id: z.string().nullable(),
  recipient_user_id: z.string().nullable(),
  attempt_count: z.number().nullable(),
  next_attempt_at: z.number().nullable(),
  created_at: z.number(),
  last_error: z.string().nullable(),
  dedupe_key: z.string().nullable(),
  // CURRENT lookupNotificationRecipients entry (users row by recipient_user_id); null when none.
  recipient: z
    .object({
      userId: z.string(),
      discordId: z.string().nullable(),
      userName: z.string().nullable(),
      notificationsEnabled: z.boolean(),
    })
    .nullable(),
});
export const AdminNotificationsResponseSchema = z.object({
  status: z.enum(["all", "pending", "processing", "sent", "failed", "cancelled"]),
  category: z.string(),
  // true when rows were dropped to keep the response under the 64 KiB API budget.
  truncated: z.boolean(),
  // CURRENT shows the thrown error text; the API returns a fixed code instead.
  error: z.literal("query_failed").nullable(),
  counts: z.object({
    pending: z.number(),
    processing: z.number(),
    failed: z.number(),
    deadLetter: z.number(),
    unhealthyLease: z.number(),
  }),
  rows: z.array(AdminNotificationRowSchema),
});

export const AdminYoutubeSyncRowSchema = z.object({
  video_id: z.string(),
  title: z.string(),
  creator_name: z.string().nullable(),
  youtube_video_id: z.string().nullable(),
  visibility_status: z.string(),
  youtube_privacy_status: z.string().nullable(),
  youtube_availability_status: z.string().nullable(),
  duration_seconds: z.number().nullable(),
  view_count: z.number().nullable(),
  sync_status: z.string().nullable(),
  sync_error: z.string().nullable(),
  synced_at: z.number().nullable(),
  updated_at: z.number().nullable(),
});
export const AdminYoutubeSyncResponseSchema = z.object({
  filters: z.object({
    sync_status: z.string(),
    privacy: z.string(),
    availability: z.string(),
    visibility: z.string(),
    failed: z.boolean(),
    stale: z.boolean(),
    missing: z.boolean(),
  }),
  hasMore: z.boolean(),
  truncated: z.boolean(),
  rows: z.array(AdminYoutubeSyncRowSchema),
});

export const AdminCostGuardResponseSchema = z.object({
  mode: z.string(),
  isMaintenance: z.boolean(),
  reason: z.string().nullable(),
  updatedAt: z.number().nullable(),
  exceptionUntil: z.number().nullable(),
  exceptionFeaturesJson: z.string().nullable(),
  disabledFeaturesJson: z.string().nullable(),
  // true when history rows were dropped to keep the response under the 64 KiB API budget.
  truncated: z.boolean(),
  // The 20 newest system_settings UPDATE audit rows; the page derives the changed keys from before/after.
  history: z.array(
    z.object({
      id: z.string(),
      created_at: z.number(),
      actor_user_id: z.string(),
      target_id: z.string(),
      before_json: z.string().nullable(),
      after_json: z.string().nullable(),
    }),
  ),
});

export type AdminCostGuardResponse = z.infer<typeof AdminCostGuardResponseSchema>;
export type AdminNotificationsResponse =z.infer<typeof AdminNotificationsResponseSchema>;
export type AdminYoutubeSyncResponse = z.infer<typeof AdminYoutubeSyncResponseSchema>;
