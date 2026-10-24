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
// The detail page shows before_json / after_json / inverse_patch_json whole; they can be up to the audit payload
// cap (default 120 KB), so they are NOT in the detail response. payload.<field> is the character length (null = SQL NULL);
// the SPA reads the text through the chunk endpoint (<= 64 KiB per response) and concatenates the chunks.
export const AdminAuditDetailRowSchema = AdminAuditRowSchema.omit({
  before_json: true,
  after_json: true,
  inverse_patch_json: true,
});
export const AdminAuditPayloadLengthsSchema = z.object({
  before: z.number().nullable(),
  after: z.number().nullable(),
  inverse: z.number().nullable(),
});
// List rows carry the payload character LENGTHS only (never the bodies, which can be up to the audit payload cap each);
// the full text stays reachable through the chunk endpoint.
export const AdminAuditListRowSchema = AdminAuditDetailRowSchema.extend({ payload: AdminAuditPayloadLengthsSchema });
export const AdminAuditListResponseSchema = z.object({
  limit: z.number(),
  // true when rows were dropped to keep the response under the 64 KiB (UTF-8 bytes) API budget (CURRENT shows all rows).
  truncated: z.boolean(),
  rows: z.array(AdminAuditListRowSchema),
  operators: z.array(AdminAuditOperatorSchema),
});
export const AdminAuditNeighborSchema = z.object({ id: z.string(), created_at: z.number() });
export const AdminAuditPayloadFieldSchema = z.enum(["before", "after", "inverse"]);
export const AdminAuditDetailResponseSchema = z.object({
  row: AdminAuditDetailRowSchema,
  payload: AdminAuditPayloadLengthsSchema,
  prev: AdminAuditNeighborSchema.nullable(),
  next: AdminAuditNeighborSchema.nullable(),
});
export const AdminAuditPayloadChunkResponseSchema = z.object({
  field: AdminAuditPayloadFieldSchema,
  total: z.number(),
  offset: z.number(),
  chunk: z.string(),
  nextOffset: z.number().nullable(),
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
export type AdminAuditSettingsResponse = z.infer<typeof AdminAuditSettingsResponseSchema>;
export type AdminAuditListResponse = z.infer<typeof AdminAuditListResponseSchema>;
export type AdminAuditDetailResponse = z.infer<typeof AdminAuditDetailResponseSchema>;
export type AdminAuditPayloadChunkResponse = z.infer<typeof AdminAuditPayloadChunkResponseSchema>;
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

export const AdminTopResponseSchema = z.object({
  counts: z.object({
    pendingVideos: z.number(),
    reservedOpenSlots: z.number(),
    xLinkRequests: z.number(),
    xMergeRequests: z.number(),
    xMergeReverts: z.number(),
    notificationFailed: z.number(),
    notificationStuck: z.number(),
    youtubeFailed: z.number(),
    moderationOpen: z.number(),
    moderationOverdue: z.number(),
  }),
  mode: z.string(),
  isMaintenance: z.number(),
});
export const AdminApiEndpointsResponseSchema = z.object({
  rows: z.array(
    z.object({
      id: z.string(),
      event_id: z.string(),
      public_api_enabled: z.number().nullable(),
      updated_at: z.number(),
      created_at: z.number(),
      event_title: z.string(),
      event_visibility_status: z.string().nullable(),
    }),
  ),
  eventOptions: z.array(
    z.object({ id: z.string(), title: z.string(), enabled: z.number().nullable() }),
  ),
});
export const AdminYoutubeQuotaResponseSchema = z.object({
  quotaDay: z.string(),
  configuredUnits: z.number(),
  budgetUnits: z.number(),
  usedUnits: z.number(),
  remainingUnits: z.number(),
  usagePercent: z.number(),
  updatedAt: z.number().nullable(),
  // CURRENT prints String(cause); the API returns a fixed code.
  error: z.literal("query_failed").nullable(),
});
export const AdminYoutubePlaylistsResponseSchema = z.object({
  filters: z.object({ enabled: z.string(), status: z.string() }),
  hasMore: z.boolean(),
  rows: z.array(
    z.object({
      event_id: z.string(),
      event_title: z.string(),
      playlist_id: z.string().nullable(),
      enabled: z.number(),
      sync_mode: z.string(),
      sync_interval_minutes: z.number(),
      sync_status: z.string(),
      next_sync_at: z.number().nullable(),
      last_synced_at: z.number().nullable(),
      last_full_scan_at: z.number().nullable(),
      last_error: z.string().nullable(),
      linked_count: z.number(),
      eligible_count: z.number(),
      synced_count: z.number(),
      health: z.object({
        level: z.enum(["ok", "warn", "critical", "unknown", "running"]),
        reason: z.string(),
        priority: z.number(),
      }),
    }),
  ),
});
export type AdminYoutubePlaylistsResponse = z.infer<typeof AdminYoutubePlaylistsResponseSchema>;
export type AdminYoutubeQuotaResponse =z.infer<typeof AdminYoutubeQuotaResponseSchema>;
export type AdminApiEndpointsResponse = z.infer<typeof AdminApiEndpointsResponseSchema>;
export const AdminPermissionSimulatorResponseSchema = z.object({
  eventId: z.string(),
  xUserId: z.string(),
  // null when event_id or x_user_id is empty (the page shows the empty panel without querying).
  result: z
    .object({
      found: z.boolean(),
      eventId: z.string(),
      xUserId: z.string().nullable(),
      displayName: z.string().nullable(),
      preset: z.string().nullable(),
      presetLabel: z.string().nullable(),
      resolvedKeys: z.array(z.string()),
      resolvedLabels: z.array(z.string()),
      spotlight: z.array(z.object({ key: z.string(), label: z.string(), allowed: z.boolean() })),
    })
    .nullable(),
});
export const AdminSecurityResponseSchema = z.object({
  status: z.enum(["all", "warn", "info", "ok"]),
  // false = no ?run=1: CURRENT renders only the "run" prompt and queries nothing.
  ran: z.boolean(),
  results: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      status: z.enum(["ok", "warn", "info"]),
      count: z.number(),
      samples: z.array(z.string()),
      note: z.string().optional(),
    }),
  ),
  error: z.literal("query_failed").nullable(),
});
const MonitorLevelSchema = z.enum(["ok", "warn", "critical", "unknown", "running"]);
const QueueSnapshotSchema = z.object({
  pending: z.number(),
  processing: z.number(),
  failed: z.number(),
  deadLetter: z.number(),
  stuck: z.number(),
  oldestPendingAt: z.number().nullable(),
});
export const AdminWorkersResponseSchema = z.object({
  snapshot: z
    .object({
      generatedAt: z.number(),
      operationMode: z.string(),
      overallLevel: z.enum(["ok", "warn", "critical", "unknown"]),
      overallMessage: z.string(),
      jobs: z.array(
        z.object({
          jobName: z.string(),
          label: z.string(),
          cadenceSeconds: z.number(),
          detailHref: z.string(),
          level: MonitorLevelSchema,
          message: z.string(),
          leaseExpiresAt: z.number().nullable(),
          lastStartedAt: z.number().nullable(),
          lastSucceededAt: z.number().nullable(),
          lastFailedAt: z.number().nullable(),
          lastErrorCode: z.string().nullable(),
          nextExpectedAt: z.number().nullable(),
        }),
      ),
      notifications: QueueSnapshotSchema,
      staticRebuilds: QueueSnapshotSchema,
      youtube: z.object({
        eligible: z.number(),
        pending: z.number(),
        stale: z.number(),
        failed: z.number(),
        oldestPendingAt: z.number().nullable(),
      }),
      scores: z.object({ eligible: z.number(), stale: z.number(), oldestUpdatedAt: z.number().nullable() }),
      artifacts: z.array(z.object({ targetType: z.string(), generatedAt: z.number().nullable() })),
      pipelines: z.array(
        z.object({
          id: z.enum(["notifications", "static", "youtube", "scores"]),
          label: z.string(),
          level: MonitorLevelSchema,
          backlog: z.number(),
          capacityPerDay: z.number(),
          estimatedDrainMinutes: z.number(),
          note: z.string(),
          detailHref: z.string(),
        }),
      ),
      // null when KV is unbound or a read failed
      queueWakeFailures: z
        .record(z.object({ at: z.number(), reason: z.string() }).nullable())
        .nullable(),
    })
    .nullable(),
  error: z.literal("query_failed").nullable(),
});
export type AdminWorkersResponse = z.infer<typeof AdminWorkersResponseSchema>;
export type AdminSecurityResponse = z.infer<typeof AdminSecurityResponseSchema>;
const BackfillRunSchema = z.object({
  cursor: z.string().nullable(),
  phase: z.enum(["shared_inputs", "items"]),
  status: z.enum(["idle", "running", "completed", "failed"]),
  total: z.number(),
  scanned: z.number(),
  enqueued: z.number(),
  last_error: z.string().nullable(),
  last_run_at: z.number().nullable(),
});
const BackfillQueueSchema = z.object({
  pending: z.number(),
  processing: z.number(),
  failed: z.number(),
  lastError: z.string().nullable(),
});
export const AdminStaticBuildsResponseSchema = z.object({
  operationMode: z.string(),
  maxItemsPerRun: z.number(),
  counts: z.object({
    pending: z.number(),
    processing: z.number(),
    failed: z.number(),
    dead_letter: z.number(),
    done: z.number(),
  }),
  backfillState: z.object({
    schema_version: z.literal(1),
    updated_at: z.number().nullable(),
    runs: z.object({ video_v2: BackfillRunSchema, user_profile: BackfillRunSchema, event_crew: BackfillRunSchema }),
  }),
  backfillQueue: z.object({
    video_v2: BackfillQueueSchema,
    user_profile: BackfillQueueSchema,
    event_crew: BackfillQueueSchema,
  }),
  // Object presence only (R2 head). loadStatus / generatedAt / itemCount of CURRENT's diagnostics need the artifact
  // bodies (R2 get + big JSON.parse) and wait for MIG-0627 (build-time snapshots).
  sharedInputs: z.array(
    z.object({
      kind: z.enum(["youtube_related_blocklist", "random_video_pool", "pickup_creators", "top_slot_stats"]),
      objectKey: z.string(),
      objectState: z.enum(["present", "missing", "unavailable"]),
    }),
  ),
  truncated: z.boolean(),
  rows: z.array(
    z.object({
      id: z.string(),
      status: z.string(),
      target_type: z.string(),
      target_id: z.string(),
      reason: z.string().nullable(),
      priority: z.string().nullable(),
      attempt_count: z.number().nullable(),
      updated_at: z.number(),
      error: z.string().nullable(),
    }),
  ),
});
export type AdminStaticBuildsResponse = z.infer<typeof AdminStaticBuildsResponseSchema>;

// Same result row as the security checks (CURRENT HealthCheckResult / SecurityCheckResult).
export const AdminDiagnosticResultSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["ok", "warn", "info"]),
  count: z.number(),
  samples: z.array(z.string()),
  note: z.string().optional(),
});
// Operational (default) health view only; the deep view is answered 501 by the API (see ops.ts).
export const AdminHealthResponseSchema = z.object({
  status: z.enum(["all", "warn", "info", "ok"]),
  results: z.array(AdminDiagnosticResultSchema),
  error: z.literal("query_failed").nullable(),
});
export type AdminHealthResponse = z.infer<typeof AdminHealthResponseSchema>;

// Integrity page: only the pre-run state is served (ran false, no results); run=1 is 501 (see ops.ts).
export const AdminIntegrityResponseSchema = z.object({ ran: z.literal(false), results: z.array(z.never()) });
export type AdminIntegrityResponse = z.infer<typeof AdminIntegrityResponseSchema>;
export type AdminPermissionSimulatorResponse =z.infer<typeof AdminPermissionSimulatorResponseSchema>;
export type AdminTopResponse =z.infer<typeof AdminTopResponseSchema>;
export type AdminCostGuardResponse =z.infer<typeof AdminCostGuardResponseSchema>;
export type AdminNotificationsResponse =z.infer<typeof AdminNotificationsResponseSchema>;
export type AdminYoutubeSyncResponse = z.infer<typeof AdminYoutubeSyncResponseSchema>;
