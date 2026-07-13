import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { events } from "./schema.base";

/**
 * イベント単位の YouTube 再生リスト同期設定と実行状態。
 * OAuth credential は Worker secret にのみ保持し、DB には保存しない。
 */
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

/**
 * 再生リストの現行項目スナップショット。
 * playlistItems.list を毎回全件取得せず、差分追加・削除を安全に行うために保持する。
 */
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
