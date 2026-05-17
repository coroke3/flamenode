import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * FlameNode D1 (SQLite) スキーマ Single Source of Truth.
 * 命名規則: snake_case で統一。Auth.js 標準カラムだけ camelCase。
 * 詳細は 設計/FlameNode-Design.md を正とする。
 */

// ============================================================
// Auth.js 標準テーブル + FlameNode 拡張
// ============================================================

export const users = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email"),
  emailVerified: integer("emailVerified", { mode: "timestamp_ms" }),
  image: text("image"),
  discord_id: text("discord_id"),
  role: text("role", { enum: ["user", "admin", "moderator"] }).default("user"),
  is_tos_accepted: integer("is_tos_accepted").default(0),
  accepted_terms_version_id: text("accepted_terms_version_id"),
  terms_reaccept_required: integer("terms_reaccept_required").default(0),
  is_banned: integer("is_banned").default(0),
  is_notification_enabled: integer("is_notification_enabled").default(1),
  active_x_user_id: text("active_x_user_id"),
  last_guild_check: integer("last_guild_check"),
  created_at: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
}, (t) => ({
  discordIdUnique: uniqueIndex("user_discord_id_unique").on(t.discord_id),
}));

export const accounts = sqliteTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.provider, t.providerAccountId] }),
  }),
);

export const sessions = sqliteTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
});

export const verificationTokens = sqliteTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.identifier, t.token] }) }),
);

// ============================================================
// X ID / クリエイター
// ============================================================

export const xUsers = sqliteTable("x_users", {
  id: text("id").primaryKey(), // X ID (@抜き)
  x_name: text("x_name").notNull(),
  icon_url: text("icon_url"),
  profile_text: text("profile_text"),
  youtube_channel_url: text("youtube_channel_url"),
  other_social_links: text("other_social_links"), // JSON
  creative_start_date: integer("creative_start_date"),
  linked_discord_user_id: text("linked_discord_user_id"),
  verification_token: text("verification_token"),
  token_expires_at: integer("token_expires_at"),
  approval_status: text("approval_status", {
    enum: ["pending", "approved", "rejected"],
  }).default("pending"),
  approval_requested_at: integer("approval_requested_at"),
});

export const xUserAliases = sqliteTable(
  "x_user_aliases",
  {
    x_user_id: text("x_user_id").notNull(),
    alias_x_id: text("alias_x_id").notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.x_user_id, t.alias_x_id] }) }),
);

export const xAccountLinkRequests = sqliteTable("x_account_link_requests", {
  id: text("id").primaryKey(),
  discord_user_id: text("discord_user_id").notNull(),
  requested_x_id: text("requested_x_id").notNull(),
  link_type: text("link_type", { enum: ["new", "merge", "alias"] }).notNull(),
  target_x_user_id: text("target_x_user_id"),
  status: text("status", {
    enum: ["pending", "approved", "rejected"],
  }).default("pending"),
  requested_at: integer("requested_at").notNull(),
});

export const xUserIcons = sqliteTable("x_user_icons", {
  id: text("id").primaryKey(),
  x_user_id: text("x_user_id").notNull(),
  icon_url: text("icon_url").notNull(),
  source_video_id: text("source_video_id"),
  source_type: text("source_type", {
    enum: ["video", "manual", "legacy"],
  }).default("video"),
  created_at: integer("created_at").notNull(),
});

// ============================================================
// イベント / スロット
// ============================================================

export const eventGroups = sqliteTable("event_groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  sort_order: integer("sort_order").default(0),
  created_at: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
  updated_at: integer("updated_at")
    .notNull()
    .default(sql`(unixepoch())`),
});

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  event_type: text("event_type", {
    enum: ["event", "collabo", "type", "other"],
  }).default("event"),
  explanation: text("explanation"),
  icon_url: text("icon_url"),
  img_url: text("img_url"),
  accent_color: text("accent_color"),
  representative_x_user_id: text("representative_x_user_id"),
  is_active: integer("is_active").notNull().default(0),
  is_entry_open: integer("is_entry_open").notNull().default(0),
  is_archived: integer("is_archived").notNull().default(0),
  event_group_id: text("event_group_id"),
  slot_type: text("slot_type", { enum: ["time", "count"] }).default("time"),
  slot_visibility_mode: text("slot_visibility_mode", {
    enum: ["public_name", "anonymous", "hidden"],
  }).default("public_name"),
  start_time: integer("start_time"),
  end_time: integer("end_time"),
  entry_start_time: integer("entry_start_time"),
  entry_end_time: integer("entry_end_time"),
  created_at: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
  updated_at: integer("updated_at")
    .notNull()
    .default(sql`(unixepoch())`),
  max_slots_per_video: integer("max_slots_per_video").notNull().default(1),
  max_consecutive_slots_per_entry: integer("max_consecutive_slots_per_entry")
    .notNull()
    .default(3),
  custom_questions: text("custom_questions"),
  review_settings: text("review_settings"),
  editable_fields: text("editable_fields"),
  repeat_rules: text("repeat_rules"),
  /** スロット表示で「部」を分ける間隔の閾値 (分)。null/未設定なら 30 分。 */
  slot_part_gap_minutes: integer("slot_part_gap_minutes").default(30),
});

export const eventEditors = sqliteTable(
  "event_editors",
  {
    event_id: text("event_id").notNull(),
    x_user_id: text("x_user_id").notNull(),
    role: text("role", { enum: ["representative", "editor"] }).default(
      "editor",
    ),
    is_public: integer("is_public").default(1),
    public_role_label: text("public_role_label"),
    operation_scope_json: text("operation_scope_json"),
    internal_note: text("internal_note"),
    approved_by_user_id: text("approved_by_user_id"),
    approved_at: integer("approved_at"),
  },
  (t) => ({ pk: primaryKey({ columns: [t.event_id, t.x_user_id] }) }),
);

export const eventCollaboratorPermissions = sqliteTable(
  "event_collaborator_permissions",
  {
    id: text("id").primaryKey(),
    event_id: text("event_id").notNull(),
    x_user_id: text("x_user_id"),
    discord_user_id: text("discord_user_id"),
    display_name: text("display_name").notNull(),
    permission_key: text("permission_key").notNull(),
    allowed: integer("allowed").notNull().default(1),
    is_public_staff: integer("is_public_staff").default(0),
    public_role_label: text("public_role_label"),
    granted_by_user_id: text("granted_by_user_id").notNull(),
    created_at: integer("created_at")
      .notNull()
      .default(sql`(unixepoch())`),
    updated_at: integer("updated_at")
      .notNull()
      .default(sql`(unixepoch())`),
  },
);

export const slots = sqliteTable("slots", {
  id: text("id").primaryKey(),
  event_id: text("event_id").notNull(),
  discord_user_id: text("discord_user_id"),
  x_user_id: text("x_user_id"),
  display_name: text("display_name"),
  slot_kind: text("slot_kind", { enum: ["time", "count"] }).default("time"),
  slot_label: text("slot_label"),
  start_time: integer("start_time"),
  end_time: integer("end_time"),
  sort_order: integer("sort_order").default(0),
  reservation_group_id: text("reservation_group_id"),
  priority_reclaim_video_id: text("priority_reclaim_video_id"),
  priority_reclaim_until: integer("priority_reclaim_until"),
  video_id: text("video_id"),
  status: text("status", {
    enum: ["available", "reserved", "submitted"],
  })
    .notNull()
    .default("available"),
  updated_at: integer("updated_at")
    .notNull()
    .default(sql`(unixepoch())`),
}, (t) => ({
  byEvent: index("slots_event_idx").on(t.event_id, t.start_time),
  byVideo: index("slots_video_idx").on(t.video_id),
}));

// ============================================================
// 作品 / 関連
// ============================================================

export const videos = sqliteTable("videos", {
  id: text("id").primaryKey(),
  primary_event_id: text("primary_event_id"),
  creator_id: text("creator_id"),
  owner_discord_user_id: text("owner_discord_user_id").notNull(),
  submission_type: text("submission_type", {
    enum: ["individual", "collab", "youtube"],
  }).notNull(),
  display_name: text("display_name").notNull(),
  display_name_yomi: text("display_name_yomi"),
  contact_x_id: text("contact_x_id").notNull(),
  icon_url: text("icon_url"),
  declared_experience: text("declared_experience"),
  title: text("title").notNull(),
  music: text("music"),
  credit: text("credit"),
  music_reference_url: text("music_reference_url"),
  closing_comment: text("closing_comment"),
  youtube_video_id: text("youtube_video_id"),
  stage_permission: text("stage_permission"),
  intro_comment: text("intro_comment"),
  outro_comment: text("outro_comment"),
  highlights: text("highlights"),
  production_story: text("production_story"),
  used_software: text("used_software"),
  custom_answers: text("custom_answers"),
  view_count: integer("view_count").default(0),
  like_count: integer("like_count").default(0),
  youtube_view_count: integer("youtube_view_count").default(0),
  trending_view_count_24h: integer("trending_view_count_24h").default(0),
  video_score: real("video_score").default(0),
  youtube_sync_status: text("youtube_sync_status", {
    enum: ["pending", "synced", "failed"],
  }).default("pending"),
  validation_errors: text("validation_errors"),
  // NOTE (posting/youtube-id-and-active-x):
  //   "unlisted" は FlameNode 内部の限定公開状態 (URL 知っている人のみ閲覧可) を指す。
  //   YouTube 側の "限定公開 (unlisted)" とは別概念。
  //   YouTube 側が限定公開であっても FlameNode 側 status が "public" なら通常公開扱い。
  //   YouTube 側の privacy 状態は将来 youtube_privacy_status カラムで管理予定 (未実装)。
  status: text("status", {
    enum: [
      "draft",
      "pending",
      "x_reapply_required",
      "public",
      "unlisted",
      "private",
      "voided",
    ],
  })
    .notNull()
    .default("draft"),
  is_manual_hidden: integer("is_manual_hidden").default(0),
  is_deleted: integer("is_deleted").default(0),
  x_reapply_request_id: text("x_reapply_request_id"),
  x_reapply_started_at: integer("x_reapply_started_at"),
  x_reapply_due_at: integer("x_reapply_due_at"),
  x_reapply_rejected_x_user_id: text("x_reapply_rejected_x_user_id"),
  x_reapply_public_reason: text("x_reapply_public_reason"),
  x_reapply_attempt_count: integer("x_reapply_attempt_count").default(0),
  x_reapply_locked_until: integer("x_reapply_locked_until"),
  voided_by_user_id: text("voided_by_user_id"),
  voided_at: integer("voided_at"),
  void_reason: text("void_reason"),
  void_reason_category: text("void_reason_category", {
    enum: [
      "x_id_invalid",
      "duplicate",
      "withdrawn_by_creator",
      "operator_decision",
      "expired",
    ],
  }),
  void_detail_private: text("void_detail_private"),
  void_physical_delete_candidate_at: integer(
    "void_physical_delete_candidate_at",
  ),
  void_restored_by_user_id: text("void_restored_by_user_id"),
  void_restored_at: integer("void_restored_at"),
  scheduling_type: text("scheduling_type", {
    enum: ["slotted", "manual"],
  }).default("slotted"),
  scheduled_time: integer("scheduled_time"),
  created_at: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
  updated_at: integer("updated_at")
    .notNull()
    .default(sql`(unixepoch())`),
}, (t) => ({
  statusIdx: index("videos_status_idx").on(t.status),
  scheduledIdx: index("videos_scheduled_idx").on(t.scheduled_time),
  scoreIdx: index("videos_score_idx").on(t.video_score),
  primaryEventIdx: index("videos_primary_event_idx").on(t.primary_event_id),
  ownerIdx: index("videos_owner_idx").on(t.owner_discord_user_id),
  creatorIdx: index("videos_creator_idx").on(t.creator_id),
  youtubeIdIdx: index("videos_youtube_id_idx").on(t.youtube_video_id),
}));

export const videoEvents = sqliteTable(
  "video_events",
  {
    video_id: text("video_id").notNull(),
    event_id: text("event_id").notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.video_id, t.event_id] }) }),
);

export const videoMembers = sqliteTable(
  "video_members",
  {
    id: text("id").primaryKey(),
    video_id: text("video_id").notNull(),
    x_user_id: text("x_user_id"),
    name: text("name").notNull(),
    role: text("role"),
    comment: text("comment"),
    order_index: integer("order_index").notNull().default(0),
    /** name を小文字化したサーバ側ソート用キャッシュ。書き込み時に同期する。 */
    name_for_sort: text("name_for_sort"),
  },
  (t) => ({
    // 表示順 (デフォルト) + 名前ソート (MemberTable の列ソート) を高速化する。
    byVideo: index("video_members_video_order_idx").on(
      t.video_id,
      t.order_index,
    ),
    byVideoName: index("video_members_video_name_idx").on(
      t.video_id,
      t.name,
    ),
    byVideoNameForSort: index("video_members_video_name_for_sort_idx").on(
      t.video_id,
      t.name_for_sort,
    ),
  }),
);

export const videoChapters = sqliteTable("video_chapters", {
  id: text("id").primaryKey(),
  video_id: text("video_id").notNull(),
  x_user_id: text("x_user_id").notNull(),
  chapter_time: real("chapter_time").notNull(),
  chapter_label: text("chapter_label").notNull(),
  note: text("note"),
  visibility: text("visibility", { enum: ["private", "public"] }).default(
    "public",
  ),
  marker_kind: text("marker_kind", {
    enum: ["comment", "chapter", "review", "system"],
  }).default("comment"),
  show_on_player_bar: integer("show_on_player_bar").default(0),
  order_index: integer("order_index").default(0),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
});

export const videoComments = sqliteTable("video_comments", {
  id: text("id").primaryKey(),
  video_id: text("video_id").notNull(),
  x_user_id: text("x_user_id").notNull(),
  chapter_id: text("chapter_id"),
  body: text("body").notNull(),
  visibility: text("visibility", { enum: ["private", "public"] }).default(
    "public",
  ),
  created_at: integer("created_at").notNull(),
});

export const videoInteractions = sqliteTable(
  "video_interactions",
  {
    id: text("id").primaryKey(),
    x_user_id: text("x_user_id").notNull(),
    video_id: text("video_id").notNull(),
    interaction_type: text("interaction_type", {
      enum: ["like", "bookmark"],
    }).notNull(),
    source: text("source", { enum: ["app", "youtube"] }).default("app"),
    created_at: integer("created_at").notNull(),
    synced_at: integer("synced_at"),
  },
  (t) => ({
    uniq: uniqueIndex("video_interactions_uniq").on(
      t.x_user_id,
      t.video_id,
      t.interaction_type,
    ),
  }),
);

// ============================================================
// 履歴・通知・統計
// ============================================================

export const historyLogs = sqliteTable("history_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  table_name: text("table_name").notNull(),
  record_id: text("record_id").notNull(),
  action: text("action", { enum: ["CREATE", "UPDATE", "DELETE"] }).notNull(),
  before_data: text("before_data"),
  after_data: text("after_data"),
  operator_discord_id: text("operator_discord_id"),
  retention_class: text("retention_class", {
    enum: ["normal", "long_audit"],
  }).default("normal"),
  created_at: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
});

export const systemSettings = sqliteTable("system_settings", {
  id: text("id").primaryKey(),
  default_editable_fields: text("default_editable_fields"),
  upcoming_editable_fields: text("upcoming_editable_fields"),
  is_maintenance_mode: integer("is_maintenance_mode").default(0),
  history_retention_days: integer("history_retention_days").default(90),
  cost_guard_mode: text("cost_guard_mode", {
    enum: ["normal", "economy", "read_only", "static_only", "maintenance"],
  }).default("normal"),
  auto_cost_guard_enabled: integer("auto_cost_guard_enabled").default(1),
  cost_guard_thresholds_json: text("cost_guard_thresholds_json"),
  disabled_features_json: text("disabled_features_json"),
  cost_guard_reason: text("cost_guard_reason"),
  cost_guard_updated_by_user_id: text("cost_guard_updated_by_user_id"),
  cost_guard_updated_at: integer("cost_guard_updated_at"),
  cost_guard_exception_until: integer("cost_guard_exception_until"),
  cost_guard_exception_features_json: text("cost_guard_exception_features_json"),
});

export const apiEndpoints = sqliteTable("api_endpoints", {
  id: text("id").primaryKey(),
  event_id: text("event_id").notNull(),
  is_active: integer("is_active").default(1),
  created_at: integer("created_at").notNull(),
});

export const customPages = sqliteTable("custom_pages", {
  id: text("id").primaryKey(),
  x_user_id: text("x_user_id").notNull(),
  html: text("html"),
  css: text("css"),
  theme_id: text("theme_id"),
  shortcode_version: text("shortcode_version"),
  is_published: integer("is_published").default(0),
  updated_at: integer("updated_at").notNull(),
});

export const customThemes = sqliteTable("custom_themes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  author: text("author"),
  description: text("description"),
  preview_image: text("preview_image"),
  template_html: text("template_html"),
  template_css: text("template_css"),
  created_at: integer("created_at").notNull(),
  is_default: integer("is_default").default(0),
});

export const recommendationSignals = sqliteTable("recommendation_signals", {
  id: text("id").primaryKey(),
  x_user_id: text("x_user_id").notNull(),
  video_id: text("video_id").notNull(),
  watch_seconds: real("watch_seconds").default(0),
  like_score: real("like_score").default(0),
  bookmark_score: real("bookmark_score").default(0),
  updated_at: integer("updated_at").notNull(),
});

export const xIdMergeRequests = sqliteTable("x_id_merge_requests", {
  id: text("id").primaryKey(),
  from_x_user_id: text("from_x_user_id").notNull(),
  to_x_user_id: text("to_x_user_id").notNull(),
  requested_by_uid: text("requested_by_uid").notNull(),
  status: text("status", {
    enum: ["pending", "approved", "rejected", "done"],
  }).default("pending"),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
});

export const xIdMergeReverts = sqliteTable("x_id_merge_reverts", {
  id: text("id").primaryKey(),
  merge_request_id: text("merge_request_id").notNull(),
  requested_by_uid: text("requested_by_uid").notNull(),
  status: text("status", {
    enum: ["pending", "approved", "rejected", "done"],
  }).default("pending"),
  restore_snapshot_json: text("restore_snapshot_json").notNull(),
  revert_deadline_at: integer("revert_deadline_at").notNull(),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
});

export const notificationOutbox = sqliteTable(
  "notification_outbox",
  {
    id: text("id").primaryKey(),
    discord_user_id: text("discord_user_id").notNull(),
    type: text("type").notNull(),
    payload_json: text("payload_json").notNull(),
    status: text("status", {
      enum: ["pending", "processing", "sent", "failed"],
    }).default("pending"),
    attempt_count: integer("attempt_count").default(0),
    next_attempt_at: integer("next_attempt_at"),
    last_error: text("last_error"),
    /** event-scoped 通知 (運営者受信箱用)。null は全体通知。 */
    event_id: text("event_id"),
    created_at: integer("created_at")
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    // Worker が status='pending' を 5 分ごとに引く + /admin/notifications の絞り込み高速化
    byStatusCreated: index("notification_outbox_status_created_idx").on(
      t.status,
      t.created_at,
    ),
    // /manage/events/[id] が event_id で絞り込むため
    byEvent: index("notification_outbox_event_idx").on(t.event_id),
  }),
);

export const announcements = sqliteTable("announcements", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  severity: text("severity", {
    enum: ["info", "warning", "danger"],
  }).default("info"),
  is_published: integer("is_published").default(0),
  publish_at: integer("publish_at"),
  expire_at: integer("expire_at"),
  target_audience: text("target_audience", {
    enum: ["all", "creators", "admins"],
  }).default("all"),
  created_by_user_id: text("created_by_user_id"),
  created_at: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
  updated_at: integer("updated_at")
    .notNull()
    .default(sql`(unixepoch())`),
});

export const dashboardMetricsCache = sqliteTable("dashboard_metrics_cache", {
  id: text("id").primaryKey(),
  total_users: integer("total_users").default(0),
  total_videos: integer("total_videos").default(0),
  active_users_last_5m: integer("active_users_last_5m").default(0),
  new_videos_last_24h: integer("new_videos_last_24h").default(0),
  updated_at: integer("updated_at").notNull(),
});

export const costUsageSnapshots = sqliteTable("cost_usage_snapshots", {
  id: text("id").primaryKey(),
  captured_at: integer("captured_at").notNull(),
  source: text("source", {
    enum: ["cloudflare_dashboard", "graphql_analytics", "estimated_local"],
  }),
  workers_requests_today: integer("workers_requests_today").default(0),
  pages_functions_requests_today: integer("pages_functions_requests_today").default(0),
  d1_rows_read_today: integer("d1_rows_read_today").default(0),
  d1_rows_written_today: integer("d1_rows_written_today").default(0),
  r2_storage_gb_month_estimate: real("r2_storage_gb_month_estimate").default(0),
  r2_class_a_month: integer("r2_class_a_month").default(0),
  r2_class_b_month: integer("r2_class_b_month").default(0),
  durable_object_requests_today: integer("durable_object_requests_today").default(0),
  durable_object_duration_gb_s_today: real("durable_object_duration_gb_s_today").default(0),
  kv_reads_today: integer("kv_reads_today").default(0),
  kv_writes_today: integer("kv_writes_today").default(0),
  queues_operations_today: integer("queues_operations_today").default(0),
  guard_mode_after_check: text("guard_mode_after_check"),
  created_at: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
});

// ============================================================
// 利用規約 / ソフト辞書
// ============================================================

export const termsVersions = sqliteTable("terms_versions", {
  id: text("id").primaryKey(),
  version_label: text("version_label").notNull(),
  body_markdown: text("body_markdown").notNull(),
  status: text("status", { enum: ["draft", "published", "archived"] }).default(
    "draft",
  ),
  severity: text("severity", { enum: ["minor", "major"] }).default("minor"),
  published_at: integer("published_at"),
  created_by_user_id: text("created_by_user_id").notNull(),
  created_at: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
  updated_at: integer("updated_at")
    .notNull()
    .default(sql`(unixepoch())`),
});

export const userTosConsents = sqliteTable("user_tos_consents", {
  id: text("id").primaryKey(),
  user_id: text("user_id").notNull(),
  terms_version_id: text("terms_version_id").notNull(),
  consented_at: integer("consented_at").notNull(),
  consent_context: text("consent_context", {
    enum: ["entry", "post", "edit", "admin"],
  }).notNull(),
});

export const softwareCatalog = sqliteTable("software_catalog", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  normalized_name: text("normalized_name").notNull(),
  category: text("category"),
  created_at: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
  updated_at: integer("updated_at")
    .notNull()
    .default(sql`(unixepoch())`),
}, (t) => ({
  normUniq: uniqueIndex("software_catalog_norm_uniq").on(t.normalized_name),
}));

export const softwareAliases = sqliteTable(
  "software_aliases",
  {
    id: text("id").primaryKey(),
    software_id: text("software_id").notNull(),
    alias: text("alias").notNull(),
    normalized_alias: text("normalized_alias").notNull(),
  },
  (t) => ({
    uniq: uniqueIndex("software_aliases_uniq").on(
      t.software_id,
      t.normalized_alias,
    ),
  }),
);
