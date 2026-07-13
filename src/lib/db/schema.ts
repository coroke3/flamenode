import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { users } from "./schema.base";

/**
 * FlameNode D1 schema overlay.
 *
 * 大半の安定した定義は schema.base.ts に保持し、このファイルでは
 * incremental migrationで拡張した高頻度テーブルだけを明示的に上書きする。
 * 明示exportは export * より優先されるため、利用側のimport名は変更しない。
 */
export * from "./schema.base";
export * from "./schema.youtube-playlist";

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
