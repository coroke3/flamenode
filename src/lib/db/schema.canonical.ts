import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { eventGroups, softwareCatalog, users } from "./schema.base.ts";

/** FlameNodeの確定DB正本。旧構造はこのファイルへ持ち込まない。 */
export const xUsers = sqliteTable("x_users", {
  id: text("id").primaryKey(),
  x_name: text("x_name").notNull(),
  icon_url: text("icon_url"),
  profile_text: text("profile_text"),
  portfolio_contact: text("portfolio_contact"),
  youtube_channel_url: text("youtube_channel_url"),
  other_social_links: text("other_social_links"),
  creative_start_date: integer("creative_start_date"),
  approval_status: text("approval_status", {
    enum: ["pending", "approved", "rejected", "imported"],
  }).default("pending"),
});

export const xIdentityRequests = sqliteTable(
  "x_identity_requests",
  {
    id: text("id").primaryKey(),
    request_type: text("request_type", {
      enum: ["new_link", "existing_link", "alias", "merge", "revert_merge"],
    }).notNull(),
    requested_by_auth_user_id: text("requested_by_auth_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    requested_x_id: text("requested_x_id"),
    source_x_user_id: text("source_x_user_id").references(() => xUsers.id, {
      onDelete: "set null",
    }),
    target_x_user_id: text("target_x_user_id").references(() => xUsers.id, {
      onDelete: "set null",
    }),
    parent_request_id: text("parent_request_id").references(
      (): AnySQLiteColumn => xIdentityRequests.id,
      { onDelete: "set null" },
    ),
    restore_snapshot_json: text("restore_snapshot_json"),
    revert_deadline_at: integer("revert_deadline_at"),
    status: text("status", {
      enum: ["pending", "approved", "rejected", "done", "cancelled"],
    })
      .notNull()
      .default("pending"),
    requested_at: integer("requested_at").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (t) => ({
    requestedByIdx: index("x_identity_requests_requested_by_idx").on(
      t.requested_by_auth_user_id,
      t.status,
      t.requested_at,
    ),
    targetIdx: index("x_identity_requests_target_idx").on(
      t.target_x_user_id,
      t.status,
    ),
    sourceIdx: index("x_identity_requests_source_idx").on(
      t.source_x_user_id,
      t.status,
    ),
    parentIdx: index("x_identity_requests_parent_idx").on(t.parent_request_id),
    shapeCheck: check(
      "x_identity_requests_shape_check",
      sql`(
        request_type IN ('new_link', 'existing_link', 'alias')
        AND requested_x_id IS NOT NULL
      ) OR (
        request_type = 'merge'
        AND source_x_user_id IS NOT NULL
        AND target_x_user_id IS NOT NULL
        AND source_x_user_id <> target_x_user_id
      ) OR (
        request_type = 'revert_merge'
        AND parent_request_id IS NOT NULL
      )`,
    ),
  }),
);

export const xUserAccountLinks = sqliteTable(
  "x_user_account_links",
  {
    x_user_id: text("x_user_id")
      .notNull()
      .references(() => xUsers.id, { onDelete: "cascade" }),
    auth_user_id: text("auth_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    link_role: text("link_role", { enum: ["owner", "manager"] })
      .notNull()
      .default("owner"),
    created_by_request_id: text("created_by_request_id").references(
      (): AnySQLiteColumn => xIdentityRequests.id,
      { onDelete: "set null" },
    ),
    created_at: integer("created_at").notNull().default(sql`(unixepoch())`),
    updated_at: integer("updated_at").notNull().default(sql`(unixepoch())`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.x_user_id, t.auth_user_id] }),
    byAuthUser: index("x_user_account_links_auth_user_idx").on(
      t.auth_user_id,
      t.link_role,
      t.x_user_id,
    ),
    byXUser: index("x_user_account_links_x_user_idx").on(
      t.x_user_id,
      t.link_role,
      t.auth_user_id,
    ),
  }),
);

export const eventGroupEvents = sqliteTable(
  "event_group_events",
  {
    event_group_id: text("event_group_id")
      .notNull()
      .references(() => eventGroups.id, { onDelete: "cascade" }),
    event_id: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    relation_type: text("relation_type", {
      enum: ["member", "primary", "related"],
    })
      .notNull()
      .default("member"),
    created_at: integer("created_at").notNull().default(sql`(unixepoch())`),
    updated_at: integer("updated_at").notNull().default(sql`(unixepoch())`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.event_group_id, t.event_id] }),
    eventIdx: index("event_group_events_event_idx").on(t.event_id),
    groupRelationIdx: index("event_group_events_group_relation_idx").on(
      t.event_group_id,
      t.relation_type,
    ),
  }),
);

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    event_type: text("event_type", {
      enum: ["event", "collabo", "type", "other"],
    }).default("event"),
    explanation: text("explanation"),
    icon_url: text("icon_url"),
    img_url: text("img_url"),
    accent_color: text("accent_color"),
    visibility_status: text("visibility_status", {
      enum: ["private", "public"],
    })
      .notNull()
      // 0043の物理defaultはdraft。0044がINSERT直後にprivateへ正規化する。
      .default("draft" as "private"),
    allow_user_video_event_links: integer("allow_user_video_event_links")
      .notNull()
      .default(0),
    allow_unslotted_posts: integer("allow_unslotted_posts")
      .notNull()
      .default(0),
    allow_user_video_edits: integer("allow_user_video_edits")
      .notNull()
      .default(0),
    user_video_edit_permission_keys_json: text(
      "user_video_edit_permission_keys_json",
    ),
    slot_type: text("slot_type", { enum: ["time", "count"] }).default("time"),
    slot_visibility_mode: text("slot_visibility_mode", {
      enum: ["public_name", "anonymous", "hidden"],
    }).default("public_name"),
    start_time: integer("start_time"),
    end_time: integer("end_time"),
    entry_start_time: integer("entry_start_time"),
    entry_end_time: integer("entry_end_time"),
    created_at: integer("created_at").notNull().default(sql`(unixepoch())`),
    updated_at: integer("updated_at").notNull().default(sql`(unixepoch())`),
    max_slots_per_video: integer("max_slots_per_video").notNull().default(1),
    review_settings: text("review_settings"),
    editable_fields: text("editable_fields"),
    repeat_rules: text("repeat_rules"),
    slot_part_gap_minutes: integer("slot_part_gap_minutes").default(15),
    parts_json: text("parts_json"),
    public_api_enabled: integer("public_api_enabled").notNull().default(0),
  },
  (t) => ({
    visibilityStartIdx: index("events_visibility_start_idx").on(
      t.visibility_status,
      t.start_time,
    ),
  }),
);

export const eventStaff = sqliteTable(
  "event_staff",
  {
    id: text("id").primaryKey(),
    event_id: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    x_user_id: text("x_user_id")
      .notNull()
      .references(() => xUsers.id, { onDelete: "restrict" }),
    display_name: text("display_name").notNull(),
    permission_preset: text("permission_preset", {
      enum: [
        "owner",
        "manager",
        "slot_manager",
        "content_editor",
        "reviewer",
        "xid_reviewer",
        "public_staff",
        "custom",
      ],
    })
      .notNull()
      .default("public_staff"),
    custom_permission_keys_json: text("custom_permission_keys_json"),
    is_public: integer("is_public").notNull().default(0),
    public_role_label: text("public_role_label"),
    approved_by_auth_user_id: text("approved_by_auth_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    approved_at: integer("approved_at"),
    created_at: integer("created_at").notNull().default(sql`(unixepoch())`),
    updated_at: integer("updated_at").notNull().default(sql`(unixepoch())`),
  },
  (t) => ({
    eventXUniq: uniqueIndex("event_staff_event_x_uniq").on(
      t.event_id,
      t.x_user_id,
    ),
    byEvent: index("event_staff_event_idx").on(t.event_id),
    ownerLookup: index("event_staff_event_preset_idx").on(
      t.event_id,
      t.permission_preset,
    ),
    publicIdx: index("event_staff_public_idx").on(
      t.event_id,
      t.is_public,
      t.display_name,
    ),
  }),
);

export const videos = sqliteTable(
  "videos",
  {
    id: text("id").primaryKey(),
    primary_event_id: text("primary_event_id").references(() => events.id, {
      onDelete: "set null",
    }),
    creator_x_user_id: text("creator_x_user_id").references(() => xUsers.id, {
      onDelete: "set null",
    }),
    submitted_by_user_id: text("submitted_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    collaboration_type: text("collaboration_type", {
      enum: ["individual", "collab"],
    })
      .notNull()
      .default("individual"),
    part: text("part"),
    source_type: text("source_type", {
      enum: ["youtube", "manual", "external"],
    })
      .notNull()
      .default("youtube"),
    creator_display_name: text("creator_display_name").notNull(),
    creator_display_name_yomi: text("creator_display_name_yomi"),
    creator_icon_url: text("creator_icon_url"),
    creator_youtube_channel_url: text("creator_youtube_channel_url"),
    title: text("title").notNull(),
    music: text("music"),
    credit: text("credit"),
    music_reference_url: text("music_reference_url"),
    closing_comment: text("closing_comment"),
    youtube_video_id: text("youtube_video_id"),
    intro_comment: text("intro_comment"),
    highlights: text("highlights"),
    production_story: text("production_story"),
    visibility_status: text("visibility_status", {
      enum: ["pending", "public", "private", "voided"],
    })
      .notNull()
      // 0043の物理defaultはdraft。0044がINSERT直後にpendingへ正規化する。
      .default("draft" as "pending"),
    scheduling_type: text("scheduling_type", {
      enum: ["slotted", "manual"],
    }).default("slotted"),
    scheduled_time: integer("scheduled_time"),
    app_like_count: integer("app_like_count").notNull().default(0),
    score: real("score").notNull().default(0),
    score_updated_at: integer("score_updated_at"),
    created_at: integer("created_at").notNull().default(sql`(unixepoch())`),
    updated_at: integer("updated_at").notNull().default(sql`(unixepoch())`),
  },
  (t) => ({
    visibilityStatusIdx: index("videos_visibility_status_idx").on(
      t.visibility_status,
    ),
    scheduledIdx: index("videos_scheduled_idx").on(t.scheduled_time),
    primaryEventIdx: index("videos_primary_event_idx").on(t.primary_event_id),
    submittedByIdx: index("videos_submitted_by_idx").on(
      t.submitted_by_user_id,
    ),
    creatorXIdx: index("videos_creator_x_idx").on(t.creator_x_user_id),
    youtubeIdIdx: index("videos_youtube_id_idx").on(t.youtube_video_id),
    publicScheduledIdx: index("videos_public_scheduled_idx").on(
      t.visibility_status,
      t.scheduled_time,
    ),
    publicScoreIdx: index("videos_public_score_idx").on(
      t.visibility_status,
      t.score,
      t.scheduled_time,
    ),
    scoreRefreshIdx: index("videos_score_refresh_idx").on(
      t.visibility_status,
      t.score_updated_at,
      t.id,
    ),
    creatorPublicIdx: index("videos_creator_public_idx").on(
      t.creator_x_user_id,
      t.visibility_status,
      t.primary_event_id,
      t.id,
    ),
    creatorFallbackIdx: index("videos_creator_fallback_idx")
      .on(t.creator_x_user_id, t.collaboration_type, t.created_at)
      .where(
        sql`creator_x_user_id IS NOT NULL AND visibility_status NOT IN ('archived', 'voided') AND (creator_icon_url IS NOT NULL OR creator_display_name IS NOT NULL)`,
      ),
    youtubeIdActiveUniq: uniqueIndex("videos_youtube_id_active_uniq")
      .on(t.youtube_video_id)
      .where(
        sql`youtube_video_id IS NOT NULL AND youtube_video_id <> '' AND visibility_status NOT IN ('archived', 'voided')`,
      ),
  }),
);

export const slots = sqliteTable(
  "slots",
  {
    id: text("id").primaryKey(),
    event_id: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    reserved_by_user_id: text("reserved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    x_user_id: text("x_user_id").references(() => xUsers.id, {
      onDelete: "set null",
    }),
    display_name: text("display_name"),
    slot_label: text("slot_label"),
    start_time: integer("start_time"),
    sort_order: integer("sort_order").default(0),
    reservation_group_id: text("reservation_group_id"),
    video_id: text("video_id").references(() => videos.id, {
      onDelete: "set null",
    }),
    status: text("status", {
      enum: ["available", "reserved", "submitted"],
    })
      .notNull()
      .default("available"),
    updated_at: integer("updated_at").notNull().default(sql`(unixepoch())`),
    version: integer("version").notNull().default(1),
  },
  (t) => ({
    byEvent: index("slots_event_idx").on(t.event_id, t.start_time),
    byVideo: index("slots_video_idx").on(t.video_id),
    byReservationGroup: index("slots_reservation_group_idx").on(
      t.reservation_group_id,
    ),
  }),
);

export const videoYoutubeMetadata = sqliteTable(
  "video_youtube_metadata",
  {
    video_id: text("video_id")
      .primaryKey()
      .references(() => videos.id, { onDelete: "cascade" }),
    youtube_privacy_status: text("youtube_privacy_status"),
    youtube_availability_status: text("youtube_availability_status"),
    duration_seconds: integer("duration_seconds"),
    view_count: integer("view_count").notNull().default(0),
    synced_at: integer("synced_at"),
    sync_status: text("sync_status", {
      enum: ["pending", "synced", "failed"],
    })
      .notNull()
      .default("pending"),
    sync_error: text("sync_error"),
    updated_at: integer("updated_at").notNull(),
  },
  (t) => ({
    bySync: index("video_youtube_metadata_sync_idx").on(
      t.sync_status,
      t.synced_at,
    ),
  }),
);

export const videoMembers = sqliteTable(
  "video_members",
  {
    id: text("id").primaryKey(),
    video_id: text("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    x_user_id: text("x_user_id").references(() => xUsers.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    role: text("role"),
    comment: text("comment"),
    order_index: integer("order_index").notNull().default(0),
    can_edit: integer("can_edit").notNull().default(0),
    is_public_member: integer("is_public_member").notNull().default(1),
    edit_granted_by_auth_user_id: text(
      "edit_granted_by_auth_user_id",
    ).references(() => users.id, { onDelete: "set null" }),
    edit_granted_at: integer("edit_granted_at"),
    edit_updated_at: integer("edit_updated_at"),
  },
  (t) => ({
    byVideo: index("video_members_video_order_idx").on(
      t.video_id,
      t.order_index,
    ),
    byVideoName: index("video_members_video_name_idx").on(t.video_id, t.name),
    byVideoCanEdit: index("video_members_video_can_edit_idx").on(
      t.video_id,
      t.can_edit,
    ),
    byXUserVideo: index("video_members_x_user_video_idx").on(
      t.x_user_id,
      t.video_id,
    ),
  }),
);

export const videoSoftwares = sqliteTable(
  "video_softwares",
  {
    video_id: text("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    software_id: text("software_id")
      .notNull()
      .references(() => softwareCatalog.id, { onDelete: "restrict" }),
    raw_label: text("raw_label").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.video_id, t.software_id] }),
    bySoftwareVideo: index("video_softwares_software_video_idx").on(
      t.software_id,
      t.video_id,
    ),
  }),
);

export const videoChapters = sqliteTable(
  "video_chapters",
  {
    id: text("id").primaryKey(),
    video_id: text("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    x_user_id: text("x_user_id").references(() => xUsers.id, {
      onDelete: "set null",
    }),
    chapter_time: real("chapter_time").notNull(),
    chapter_label: text("chapter_label").notNull(),
    note: text("note"),
    visibility: text("visibility", { enum: ["private", "public"] })
      .notNull()
      .default("public"),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (t) => ({
    byVideoTime: index("video_chapters_video_time_idx").on(
      t.video_id,
      t.chapter_time,
    ),
    byVideoVisibility: index("video_chapters_video_visibility_idx").on(
      t.video_id,
      t.visibility,
      t.chapter_time,
    ),
  }),
);

export const videoInteractions = sqliteTable(
  "video_interactions",
  {
    x_user_id: text("x_user_id")
      .notNull()
      .references(() => xUsers.id, { onDelete: "cascade" }),
    video_id: text("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    interaction_type: text("interaction_type", {
      enum: ["like", "bookmark"],
    }).notNull(),
    created_at: integer("created_at").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.x_user_id, t.video_id, t.interaction_type] }),
    byVideoType: index("video_interactions_video_type_idx").on(
      t.video_id,
      t.interaction_type,
      t.created_at,
    ),
  }),
);

export const systemSettings = sqliteTable(
  "system_settings",
  {
    id: text("id").primaryKey(),
    default_editable_fields: text("default_editable_fields"),
    upcoming_editable_fields: text("upcoming_editable_fields"),
    operation_mode: text("operation_mode", {
      enum: ["normal", "economy", "read_only", "static_only", "maintenance"],
    }).default("normal"),
    disabled_features_json: text("disabled_features_json"),
    cost_guard_reason: text("cost_guard_reason"),
    cost_guard_updated_by_user_id: text(
      "cost_guard_updated_by_user_id",
    ).references(() => users.id, { onDelete: "set null" }),
    cost_guard_updated_at: integer("cost_guard_updated_at"),
    cost_guard_exception_until: integer("cost_guard_exception_until"),
    cost_guard_exception_features_json: text(
      "cost_guard_exception_features_json",
    ),
    audit_normal_retention_days: integer("audit_normal_retention_days")
      .notNull()
      .default(30),
    audit_restorable_retention_days: integer("audit_restorable_retention_days")
      .notNull()
      .default(180),
    audit_long_retention_days: integer("audit_long_retention_days")
      .notNull()
      .default(365),
    audit_max_payload_bytes: integer("audit_max_payload_bytes")
      .notNull()
      .default(120000),
    audit_compact_after_days: integer("audit_compact_after_days")
      .notNull()
      .default(30),
    audit_updated_by_auth_user_id: text(
      "audit_updated_by_auth_user_id",
    ).references(() => users.id, { onDelete: "set null" }),
    audit_updated_at: integer("audit_updated_at")
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    operationModeIdx: index("system_settings_operation_mode_idx").on(
      t.operation_mode,
    ),
  }),
);

export const softwareAliases = sqliteTable(
  "software_aliases",
  {
    software_id: text("software_id")
      .notNull()
      .references(() => softwareCatalog.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    normalized_alias: text("normalized_alias").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.software_id, t.normalized_alias] }),
    globalAliasUniq: uniqueIndex("software_aliases_global_alias_uniq").on(
      t.normalized_alias,
    ),
  }),
);

export const eventYoutubePlaylistSync = sqliteTable(
  "event_youtube_playlist_sync",
  {
    event_id: text("event_id")
      .primaryKey()
      .references(() => events.id, { onDelete: "cascade" }),
    playlist_id: text("playlist_id"),
    enabled: integer("enabled").notNull().default(0),
    sync_mode: text("sync_mode", {
      enum: ["off", "append_only", "mirror"],
    })
      .notNull()
      .default("off"),
    sync_interval_minutes: integer("sync_interval_minutes")
      .notNull()
      .default(720),
    sync_status: text("sync_status", {
      enum: ["disabled", "idle", "scanning", "synced", "deferred", "failed"],
    })
      .notNull()
      .default("disabled"),
    next_sync_at: integer("next_sync_at"),
    last_synced_at: integer("last_synced_at"),
    last_full_scan_at: integer("last_full_scan_at"),
    scan_started_at: integer("scan_started_at"),
    scan_page_token: text("scan_page_token"),
    last_error: text("last_error"),
    created_at: integer("created_at").notNull().default(sql`(unixepoch())`),
    updated_at: integer("updated_at").notNull().default(sql`(unixepoch())`),
  },
  (t) => ({
    dueIdx: index("event_youtube_playlist_sync_due_idx").on(
      t.enabled,
      t.next_sync_at,
      t.event_id,
    ),
    playlistUnique: uniqueIndex("event_youtube_playlist_sync_playlist_uniq")
      .on(t.playlist_id)
      .where(sql`playlist_id IS NOT NULL AND playlist_id <> ''`),
  }),
);

export const eventYoutubePlaylistItems = sqliteTable(
  "event_youtube_playlist_items",
  {
    event_id: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    playlist_item_id: text("playlist_item_id").notNull(),
    youtube_video_id: text("youtube_video_id").notNull(),
    seen_at: integer("seen_at").notNull(),
    managed_by_flamenode: integer("managed_by_flamenode")
      .notNull()
      .default(0),
    created_at: integer("created_at").notNull().default(sql`(unixepoch())`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.event_id, t.playlist_item_id] }),
    byEventVideo: index("event_youtube_playlist_items_event_video_idx").on(
      t.event_id,
      t.youtube_video_id,
    ),
    playlistItemUnique: uniqueIndex(
      "event_youtube_playlist_items_playlist_item_uniq",
    ).on(t.playlist_item_id),
  }),
);

export const workerLeases = sqliteTable("worker_leases", {
  job_name: text("job_name").primaryKey(),
  lease_token: text("lease_token").notNull(),
  lease_expires_at: integer("lease_expires_at").notNull(),
  updated_at: integer("updated_at").notNull().default(sql`(unixepoch())`),
  last_started_at: integer("last_started_at"),
  last_succeeded_at: integer("last_succeeded_at"),
  last_failed_at: integer("last_failed_at"),
  last_error_code: text("last_error_code"),
});

export const externalApiQuotaUsage = sqliteTable(
  "external_api_quota_usage",
  {
    provider: text("provider").notNull(),
    quota_day: text("quota_day").notNull(),
    used_units: integer("used_units").notNull().default(0),
    limit_units: integer("limit_units").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.provider, t.quota_day] }),
  }),
);
