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
import { users } from "./schema.base.ts";

/**
 * FlameNode D1 schemaの唯一の公開正本。
 *
 * `schema.base.ts`はこのmoduleだけが読む内部定義fragmentであり、アプリ、Worker、
 * test、文書から直接参照してはいけない。外部利用側は必ずこのfileからimportする。
 * active migrationで追加された列・indexを含む最終定義は、このmoduleの明示exportを
 * 優先して確定する。schema検査はfragmentと最終overrideを合成し、active migrationと
 * 完全一致することを確認する。
 */
export * from "./schema.base.ts";

export const xUsers = sqliteTable(
  "x_users",
  {
    id: text("id").primaryKey(),
    x_name: text("x_name").notNull(),
    icon_url: text("icon_url"),
    profile_text: text("profile_text"),
    portfolio_contact: text("portfolio_contact"),
    youtube_channel_url: text("youtube_channel_url"),
    other_social_links: text("other_social_links"),
    creative_start_date: integer("creative_start_date"),
    linked_user_id: text("linked_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    verification_token: text("verification_token"),
    token_expires_at: integer("token_expires_at"),
    approval_status: text("approval_status", {
      enum: ["pending", "approved", "rejected"],
    }).default("pending"),
    approval_requested_at: integer("approval_requested_at"),
  },
  (t) => ({
    linkedApprovalIdx: index("x_users_linked_approval_idx").on(
      t.linked_user_id,
      t.approval_status,
      t.id,
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
    representative_x_user_id: text("representative_x_user_id"),
    visibility_status: text("visibility_status", {
      enum: ["draft", "private", "public", "archived"],
    })
      .notNull()
      .default("draft"),
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
    slot_type: text("slot_type", { enum: ["time", "count"] }).default(
      "time",
    ),
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
    max_consecutive_slots_per_entry: integer(
      "max_consecutive_slots_per_entry",
    )
      .notNull()
      .default(3),
    review_settings: text("review_settings"),
    editable_fields: text("editable_fields"),
    repeat_rules: text("repeat_rules"),
    slot_part_gap_minutes: integer("slot_part_gap_minutes").default(15),
    parts_json: text("parts_json"),
    public_api_enabled: integer("public_api_enabled").notNull().default(0),
    public_api_updated_at: integer("public_api_updated_at"),
  },
  (t) => ({
    visibilityStartIdx: index("events_visibility_start_idx").on(
      t.visibility_status,
      t.start_time,
    ),
  }),
);

/** イベント単位のYouTube再生リスト同期設定と実行状態。 */
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
    created_at: integer("created_at")
      .notNull()
      .default(sql`(unixepoch())`),
    updated_at: integer("updated_at")
      .notNull()
      .default(sql`(unixepoch())`),
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

/** YouTube再生リストの現行項目索引。 */
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
    created_at: integer("created_at")
      .notNull()
      .default(sql`(unixepoch())`),
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

export const videos = sqliteTable(
  "videos",
  {
    id: text("id").primaryKey(),
    primary_event_id: text("primary_event_id"),
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
      enum: [
        "draft",
        "pending",
        "public",
        "limited",
        "private",
        "archived",
        "voided",
      ],
    })
      .notNull()
      .default("draft"),
    scheduling_type: text("scheduling_type", {
      enum: ["slotted", "manual"],
    }).default("slotted"),
    scheduled_time: integer("scheduled_time"),
    app_like_count: integer("app_like_count").notNull().default(0),
    score: real("score").notNull().default(0),
    score_updated_at: integer("score_updated_at"),
    created_at: integer("created_at")
      .notNull()
      .default(sql`(unixepoch())`),
    updated_at: integer("updated_at")
      .notNull()
      .default(sql`(unixepoch())`),
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
    user_id: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    can_edit: integer("can_edit").notNull().default(0),
    is_public_member: integer("is_public_member").notNull().default(1),
    edit_granted_by_user_id: text("edit_granted_by_user_id"),
    edit_granted_at: integer("edit_granted_at"),
    edit_updated_at: integer("edit_updated_at"),
    chapters_json: text("chapters_json"),
  },
  (t) => ({
    byVideo: index("video_members_video_order_idx").on(
      t.video_id,
      t.order_index,
    ),
    byVideoName: index("video_members_video_name_idx").on(
      t.video_id,
      t.name,
    ),
    byVideoCanEdit: index("video_members_video_can_edit_idx").on(
      t.video_id,
      t.can_edit,
    ),
    byUser: index("video_members_user_idx").on(t.user_id),
    byXUserVideo: index("video_members_x_user_video_idx").on(
      t.x_user_id,
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
    x_user_id: text("x_user_id")
      .notNull()
      .references(() => xUsers.id, { onDelete: "restrict" }),
    chapter_time: real("chapter_time").notNull(),
    chapter_label: text("chapter_label").notNull(),
    note: text("note"),
    visibility: text("visibility", {
      enum: ["private", "public"],
    }).default("public"),
    show_on_player_bar: integer("show_on_player_bar").default(0),
    order_index: integer("order_index").default(0),
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
    ),
  }),
);

export const workerLeases = sqliteTable("worker_leases", {
  job_name: text("job_name").primaryKey(),
  lease_token: text("lease_token").notNull(),
  lease_expires_at: integer("lease_expires_at").notNull(),
  updated_at: integer("updated_at")
    .notNull()
    .default(sql`(unixepoch())`),
  last_started_at: integer("last_started_at"),
  last_succeeded_at: integer("last_succeeded_at"),
  last_failed_at: integer("last_failed_at"),
  last_error_code: text("last_error_code"),
});
