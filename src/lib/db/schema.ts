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
 *
 * 実装上の正本はこのファイル。設計書・運用手順・手動 SQL migration は
 * この定義に追従させる。migrations/meta は古い Drizzle snapshot で止まっており、
 * 0010 以降は手動 SQL migration を含むため、docs/operations.md の注意を読むこと。
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
  portfolio_contact: text("portfolio_contact"),
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

export const xUserIcons = sqliteTable(
  "x_user_icons",
  {
    id: text("id").primaryKey(),
    x_user_id: text("x_user_id").notNull(),
    icon_url: text("icon_url").notNull(),
    source_video_id: text("source_video_id"),
    source_type: text("source_type", {
      enum: ["video", "manual", "legacy"],
    }).default("video"),
    created_at: integer("created_at").notNull(),
  },
  (t) => ({
    // 同じ X ID で同じ icon_url を二重登録しないための unique 制約。
    // recordXIconCandidateFromVideo (作品保存時の候補記録) や
    // uploadVideoIconCandidate (作品向けアップロード) を onConflictDoNothing で書けるようにする。
    userUrlUnique: uniqueIndex("x_user_icons_user_url_uniq").on(
      t.x_user_id,
      t.icon_url,
    ),
    byUserCreated: index("x_user_icons_user_created_idx").on(
      t.x_user_id,
      t.created_at,
    ),
  }),
);

// ============================================================
// イベント / スロット
// ============================================================

export const eventGroups = sqliteTable("event_groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  group_type: text("group_type", {
    enum: ["series", "genre", "related", "collection", "other"],
  })
    .notNull()
    .default("series"),
  icon_url: text("icon_url"),
  img_url: text("img_url"),
  accent_color: text("accent_color"),
  visibility_status: text("visibility_status", {
    enum: ["public", "private", "archived"],
  })
    .notNull()
    .default("public"),
  sort_order: integer("sort_order").default(0),
  created_at: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
  updated_at: integer("updated_at")
    .notNull()
    .default(sql`(unixepoch())`),
}, (t) => ({
  slugUniq: uniqueIndex("event_groups_slug_uniq").on(t.slug),
  typeSortIdx: index("event_groups_type_sort_idx").on(t.group_type, t.sort_order),
  visibilitySortIdx: index("event_groups_visibility_sort_idx").on(t.visibility_status, t.sort_order),
}));

export const eventGroupEvents = sqliteTable("event_group_events", {
  event_group_id: text("event_group_id").notNull(),
  event_id: text("event_id").notNull(),
  relation_type: text("relation_type", {
    enum: ["member", "primary", "related"],
  })
    .notNull()
    .default("member"),
  sort_order: integer("sort_order").notNull().default(0),
  created_at: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
  updated_at: integer("updated_at")
    .notNull()
    .default(sql`(unixepoch())`),
}, (t) => ({
  primaryKey: primaryKey({
    columns: [t.event_group_id, t.event_id],
  }),
  eventIdx: index("event_group_events_event_idx").on(t.event_id),
  groupSortIdx: index("event_group_events_group_sort_idx").on(t.event_group_id, t.sort_order),
  relationIdx: index("event_group_events_relation_idx").on(t.relation_type),
}));

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
  /**
   * 一般ユーザー (作品投稿者) が、このイベントを既存作品の追加所属イベントとして
   * 紐付けてよいか。
   *   0 = 不許可。イベント運営・管理者のみが video_events を追加できる
   *   1 = 許可。作品投稿者・編集者が「所属イベント」チェックボックスから選べる
   * デフォルト 0 (運営承認制) で、緩めたいイベントだけ 1 にする。
   */
  allow_user_video_event_links: integer("allow_user_video_event_links")
    .notNull()
    .default(0),
  /**
   * このイベントに紐付いた作品について、一般ユーザー (作品オーナーや合作メンバー
   * 以外) にもイベント単位で編集権限を委譲するか。
   *   0 = 委譲しない (既定)。動画オーナー / 合作メンバー / イベント運営のみ編集可。
   *   1 = 委譲する。`user_video_edit_permission_keys_json` で許可キーを限定する。
   */
  allow_user_video_edits: integer("allow_user_video_edits")
    .notNull()
    .default(0),
  /**
   * `allow_user_video_edits = 1` の場合に、ユーザーへ委譲する section_key 一覧。
   * JSON 配列を文字列で保持する (D1 に JSON 型がないため)。
   * 例: `["videos.title","videos.music_credit","videos.members","videos.review_data"]`
   * 危険キー (videos.youtube_id / videos.primary_event / video.identity) は
   * サーバー側で除外して読み込む。
   */
  user_video_edit_permission_keys_json: text("user_video_edit_permission_keys_json"),
  /**
   * JSON settings for event-scoped video submission fields.
   * Currently formalizes the optional/required stage_permission field.
   */
  video_form_settings_json: text("video_form_settings_json"),
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
  /**
   * スロット表示で「部」を分ける間隔の閾値 (分)。
   * 実装方針は 15 分。0006 は SQLite/D1 既定値が DEFAULT 30 のままのDBがあるため、
   * 読み取り時は実値を優先し、NULL/未設定だけアプリ側 fallback 15 として扱う。
   */
  slot_part_gap_minutes: integer("slot_part_gap_minutes").default(15),
  /**
   * このイベントで作品が選択できる「部」(セクション/カテゴリ) の候補リスト。
   * JSON 配列の文字列 (例: '["1部","2部"]')。null/空配列なら「部」UI は非表示。
   * 旧データの type 列に相当する分類項目をイベント単位で定義できる。
   */
  parts_json: text("parts_json"),
  /** 公開イベント API（旧 api_endpoints 代替）。管理者が ON にするまで 0 */
  public_api_enabled: integer("public_api_enabled").notNull().default(0),
  public_api_updated_at: integer("public_api_updated_at"),
});

/** イベント設定テンプレート（管理者のみ。枠・作品・スタッフは含まない） */
export const eventTemplates = sqliteTable(
  "event_templates",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    source_event_id: text("source_event_id"),
    settings_json: text("settings_json").notNull(),
    created_by_user_id: text("created_by_user_id").notNull(),
    created_at: integer("created_at")
      .notNull()
      .default(sql`(unixepoch())`),
    updated_at: integer("updated_at")
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    updatedIdx: index("event_templates_updated_idx").on(t.updated_at),
  }),
);

export const eventStaff = sqliteTable(
  "event_staff",
  {
    id: text("id").primaryKey(),
    event_id: text("event_id").notNull(),
    x_user_id: text("x_user_id"),
    discord_user_id: text("discord_user_id"),
    display_name: text("display_name").notNull(),
    role: text("role", { enum: ["representative", "editor", "staff"] })
      .notNull()
      .default("staff"),
    is_public: integer("is_public").notNull().default(0),
    public_role_label: text("public_role_label"),
    internal_note: text("internal_note"),
    approved_by_user_id: text("approved_by_user_id"),
    approved_at: integer("approved_at"),
    /** event_staff_permissions 統合先（JSON 配列） */
    permission_keys_json: text("permission_keys_json"),
    created_at: integer("created_at")
      .notNull()
      .default(sql`(unixepoch())`),
    updated_at: integer("updated_at")
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    eventXUniq: uniqueIndex("event_staff_event_x_uniq").on(
      t.event_id,
      t.x_user_id,
    ),
    eventDiscordUniq: uniqueIndex("event_staff_event_discord_uniq").on(
      t.event_id,
      t.discord_user_id,
    ),
    byEvent: index("event_staff_event_idx").on(t.event_id),
  }),
);

export const eventStaffPermissions = sqliteTable(
  "event_staff_permissions",
  {
    id: text("id").primaryKey(),
    event_staff_id: text("event_staff_id").notNull(),
    permission_key: text("permission_key").notNull(),
    allowed: integer("allowed").notNull().default(1),
    created_at: integer("created_at")
      .notNull()
      .default(sql`(unixepoch())`),
    updated_at: integer("updated_at")
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    staffPermissionUniq: uniqueIndex("event_staff_permissions_staff_key_uniq")
      .on(t.event_staff_id, t.permission_key),
    byPermission: index("event_staff_permissions_key_allowed_idx").on(
      t.permission_key,
      t.allowed,
    ),
  }),
);

/**
 * 作品 (video) 単位の合作メンバー編集権限。
 *
 * 「主となるユーザー (作者 / admin / イベント運営の identity 編集権限保持者) が、
 * 合作メンバーに編集権限を渡す」用途の単純なゲートテーブル。
 *
 * 粒度は can_edit ON/OFF のみ。編集可能範囲は、そのユーザーが持つ全体権限・
 * イベント編集権限に従う (細粒度の section 別判定は持たない)。
 *
 * X ID 未連携のメンバーにも先に権限を付与しておけて、後で Discord 連携・
 * 承認された時に getApprovedXIds 経由で有効化される。
 */
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
  // identity / owner
  primary_event_id: text("primary_event_id"),
  creator_x_user_id: text("creator_x_user_id"),
  submitted_by_discord_user_id: text("submitted_by_discord_user_id").notNull(),
  // classification
  collaboration_type: text("collaboration_type", {
    enum: ["individual", "collab"],
  })
    .notNull()
    .default("individual"),
  /**
   * 作品が所属する「部」名 (events.parts_json の候補から選ばれた文字列)。
   * 旧データの type 列に相当する分類項目で、イベントが parts_json を持つ場合のみ
   * UI に出る。null なら未設定。
   */
  part: text("part"),
  source_type: text("source_type", {
    enum: ["youtube", "manual", "external"],
  })
    .notNull()
    .default("youtube"),
  // creator display snapshot
  creator_display_name: text("creator_display_name").notNull(),
  creator_display_name_yomi: text("creator_display_name_yomi"),
  creator_icon_url: text("creator_icon_url"),
  // basic content
  title: text("title").notNull(),
  music: text("music"),
  credit: text("credit"),
  music_reference_url: text("music_reference_url"),
  closing_comment: text("closing_comment"),
  youtube_video_id: text("youtube_video_id"),
  stage_permission: text("stage_permission"),
  intro_comment: text("intro_comment"),
  highlights: text("highlights"),
  production_story: text("production_story"),
  custom_answers: text("custom_answers"),
  // NOTE (posting/youtube-id-and-active-x):
  //   "unlisted" は FlameNode 内部の限定公開状態 (URL 知っている人のみ閲覧可) を指す。
  //   YouTube 側の "限定公開 (unlisted)" とは別概念。
  //   YouTube 側が限定公開であっても FlameNode 側 status が "public" なら通常公開扱い。
  //   YouTube 側の privacy 状態は video_youtube_metadata.youtube_privacy_status で管理する。
  visibility_status: text("visibility_status", {
    enum: [
      "draft",
      "pending",
      "public",
      "limited",
      "private",
      "hidden",
      "archived",
      "voided",
    ],
  })
    .notNull()
    .default("draft"),
  // scheduling
  scheduling_type: text("scheduling_type", {
    enum: ["slotted", "manual"],
  }).default("slotted"),
  scheduled_time: integer("scheduled_time"),
  /** 旧 soft 列・レガシーインポート由来の使用ソフト（JSON） */
  used_software_json: text("used_software_json"),
  /**
   * 表示クエリ向けの統計正本。0024 以降の新規表示クエリは videos.* を優先する。
   * video_stats は score-recalc worker / 旧DB fallback 用に当面 dual-write で残す。
   */
  app_like_count: integer("app_like_count").notNull().default(0),
  score: real("score").notNull().default(0),
  trending_view_count_24h: integer("trending_view_count_24h").notNull().default(0),
  score_updated_at: integer("score_updated_at"),
  // timestamps
  created_at: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
  updated_at: integer("updated_at")
    .notNull()
    .default(sql`(unixepoch())`),
}, (t) => ({
  visibilityStatusIdx: index("videos_visibility_status_idx").on(t.visibility_status),
  scheduledIdx: index("videos_scheduled_idx").on(t.scheduled_time),
  primaryEventIdx: index("videos_primary_event_idx").on(t.primary_event_id),
  submittedByIdx: index("videos_submitted_by_idx").on(t.submitted_by_discord_user_id),
  creatorXIdx: index("videos_creator_x_idx").on(t.creator_x_user_id),
  youtubeIdIdx: index("videos_youtube_id_idx").on(t.youtube_video_id),
  // posting/youtube-id-and-active-x:
  //   同時投稿レース対策。createFreeVideo / submitSlotVideo / updateVideo は
  //   SELECT で重複確認してから insert/update しているが、その間に他クライアントが
  //   同じ youtube_video_id を投稿し得る。voided / 削除済みは別作品扱いなので
  //   partial unique index で active な行のみ制約する。
  //   migration: 0007_dapper_slot_events.sql
  youtubeIdActiveUniq: uniqueIndex("videos_youtube_id_active_uniq")
    .on(t.youtube_video_id)
    .where(
      sql`youtube_video_id IS NOT NULL AND youtube_video_id <> '' AND visibility_status NOT IN ('archived', 'voided')`,
    ),
}));

export const videoYoutubeMetadata = sqliteTable("video_youtube_metadata", {
  video_id: text("video_id").primaryKey(),
  youtube_video_id: text("youtube_video_id"),
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
}, (t) => ({
  byYoutubeId: index("video_youtube_metadata_youtube_idx").on(t.youtube_video_id),
  bySync: index("video_youtube_metadata_sync_idx").on(
    t.sync_status,
    t.synced_at,
  ),
}));

export const videoStats = sqliteTable("video_stats", {
  video_id: text("video_id").primaryKey(),
  app_view_count: integer("app_view_count").notNull().default(0),
  app_like_count: integer("app_like_count").notNull().default(0),
  trending_view_count_24h: integer("trending_view_count_24h").notNull().default(0),
  score: real("score").notNull().default(0),
  updated_at: integer("updated_at").notNull(),
}, (t) => ({
  byScore: index("video_stats_score_idx").on(t.score),
  byTrending: index("video_stats_trending_idx").on(t.trending_view_count_24h),
}));

export const videoModerationCases = sqliteTable("video_moderation_cases", {
  id: text("id").primaryKey(),
  video_id: text("video_id").notNull(),
  case_type: text("case_type", {
    enum: ["x_reapply", "void", "duplicate", "rights", "operator"],
  }).notNull(),
  status: text("status", {
    enum: ["open", "resolved", "rejected", "expired", "cancelled"],
  })
    .notNull()
    .default("open"),
  public_reason: text("public_reason"),
  private_note: text("private_note"),
  due_at: integer("due_at"),
  locked_until: integer("locked_until"),
  attempt_count: integer("attempt_count").notNull().default(0),
  related_x_user_id: text("related_x_user_id"),
  created_by_user_id: text("created_by_user_id"),
  resolved_by_user_id: text("resolved_by_user_id"),
  created_at: integer("created_at").notNull(),
  resolved_at: integer("resolved_at"),
}, (t) => ({
  byVideo: index("video_moderation_cases_video_idx").on(t.video_id, t.created_at),
  byTypeStatus: index("video_moderation_cases_type_status_idx").on(
    t.case_type,
    t.status,
  ),
}));

export const videoEvents = sqliteTable(
  "video_events",
  {
    video_id: text("video_id").notNull(),
    event_id: text("event_id").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.video_id, t.event_id] }),
    byEventVideo: index("video_events_event_video_idx").on(
      t.event_id,
      t.video_id,
    ),
  }),
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
    /**
     * Per-member assignment chapters.
     * video_members intentionally owns public members, private collaborators,
     * member assignment chapters, and collaborator edit grants.
     */
    chapters_json: text("chapters_json"),
    /**
     * X ID 未連携の Discord ユーザーにも先に編集権限を付与できるよう保持する。
     * 連携後は x_user_id 側でも判定できるが、両方残しておくと履歴が辿りやすい。
     */
    discord_user_id: text("discord_user_id"),
    /**
     * 1 = この video_member は作品単位の共同編集者として扱う (can_edit ON)。
     * 範囲は `COLLABORATOR_VIDEO_EDIT_KEYS` で制限される (危険キーは触れない)。
     * 0 = 表示・担当メンバーではあるが編集権限は無い。
     */
    can_edit: integer("can_edit").notNull().default(0),
    /**
     * 1 = 公開ページのメンバー欄に表示する。
     * 0 = 編集権限・チャプター担当用の非公開メンバー。公開メンバー欄には出さない。
     */
    is_public_member: integer("is_public_member").notNull().default(1),
    /** 編集権限を付与した Discord ユーザー ID (history_logs の operator と一致)。 */
    edit_granted_by_user_id: text("edit_granted_by_user_id"),
    /** 編集権限が初めて付与された時刻 (unixepoch)。 */
    edit_granted_at: integer("edit_granted_at"),
    /** can_edit が最後に変更された時刻 (unixepoch)。 */
    edit_updated_at: integer("edit_updated_at"),
  },
  (t) => ({
    // 表示順 (デフォルト) + 名前ソート (MemberSection の列ソート) を高速化する。
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
    byDiscord: index("video_members_discord_idx").on(t.discord_user_id),
  }),
);

/**
 * メンバーチャプター。
 * 通常のチャプターコメント (video_chapters) とは別データ・別UI・別保存処理として扱う。
 * 作品編集ページの VideoMembersField でメンバー行ごとに編集される。
 * 公開動画詳細ページの MemberSection に「メンバーチャプター」タブで表示される。
 */
export const videoChapters = sqliteTable("video_chapters", {
  id: text("id").primaryKey(),
  video_id: text("video_id").notNull(),
  x_user_id: text("x_user_id").notNull(),
  /**
   * @deprecated 旧仕様: メンバーチャプターを video_chapters に混在させていた頃の列。
   * 新仕様では `video_members.chapters_json` が正本。読み取り・書き込みで使わない。
   */
  video_member_id: text("video_member_id"),
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
}, (t) => ({
  byVideoTime: index("video_chapters_video_time_idx").on(
    t.video_id,
    t.chapter_time,
  ),
  byVideoMember: index("video_chapters_video_member_idx").on(t.video_member_id),
}));

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
  /**
   * 監査ログ表示用の actor スナップショット (Discord 名 / X 名 / アイコン)。
   * Discord/X のユーザー情報は後から変更されうるため、当時の表示用に固定して持つ。
   * JSON 文字列で `{ discord_user_id, discord_name, x_user_id, x_name, icon_url }`。
   */
  operator_snapshot_json: text("operator_snapshot_json"),
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
  /** 正本の動作モード。cost_guard_mode から移行予定。 */
  operation_mode: text("operation_mode", {
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
      enum: ["pending", "processing", "sent", "failed", "cancelled"],
    }).default("pending"),
    attempt_count: integer("attempt_count").default(0),
    processing_started_at: integer("processing_started_at"),
    next_attempt_at: integer("next_attempt_at"),
    last_error: text("last_error"),
    /** event-scoped 通知 (運営者受信箱用)。null は全体通知。 */
    event_id: text("event_id"),
    /** 同一通知の重複 enqueue 防止 (pending/processing/sent で unique) */
    dedupe_key: text("dedupe_key"),
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
    byProcessingStarted: index("notification_outbox_processing_started_idx").on(
      t.status,
      t.processing_started_at,
    ),
    // /manage/events/[id] が event_id で絞り込むため
    byEvent: index("notification_outbox_event_idx").on(t.event_id),
    byDedupe: index("notification_outbox_dedupe_idx").on(t.dedupe_key),
    byStatusDedupe: index("notification_outbox_status_dedupe_idx").on(
      t.status,
      t.dedupe_key,
    ),
    activeDedupeUniq: uniqueIndex("notification_outbox_active_dedupe_uniq")
      .on(t.dedupe_key)
      .where(sql`dedupe_key IS NOT NULL AND status IN ('pending', 'processing', 'sent')`),
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
  usage_count: integer("usage_count").notNull().default(0),
  is_active: integer("is_active").notNull().default(1),
  is_verified: integer("is_verified").notNull().default(0),
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
    globalAliasUniq: uniqueIndex("software_aliases_global_alias_uniq").on(
      t.normalized_alias,
    ),
  }),
);

export const videoSoftwares = sqliteTable(
  "video_softwares",
  {
    video_id: text("video_id").notNull(),
    software_id: text("software_id").notNull(),
    raw_label: text("raw_label").notNull(),
    order_index: integer("order_index").notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.video_id, t.software_id] }),
    bySoftware: index("video_softwares_software_video_idx").on(
      t.software_id,
      t.video_id,
    ),
    byVideoOrder: index("video_softwares_video_order_idx").on(
      t.video_id,
      t.order_index,
    ),
  }),
);

/** R2 公開用静的 JSON の再生成キュー（Next.js ビルドとは無関係） */
export const staticRebuildQueue = sqliteTable(
  "static_rebuild_queue",
  {
    id: text("id").primaryKey(),
    target_type: text("target_type").notNull(),
    target_id: text("target_id").notNull(),
    reason: text("reason"),
    priority: text("priority", { enum: ["high", "normal", "low"] })
      .notNull()
      .default("normal"),
    status: text("status", {
      enum: ["pending", "processing", "done", "failed"],
    })
      .notNull()
      .default("pending"),
    attempt_count: integer("attempt_count").notNull().default(0),
    requested_by_user_id: text("requested_by_user_id"),
    created_at: integer("created_at")
      .notNull()
      .default(sql`(unixepoch())`),
    updated_at: integer("updated_at")
      .notNull()
      .default(sql`(unixepoch())`),
    processing_started_at: integer("processing_started_at"),
    processed_at: integer("processed_at"),
    next_retry_at: integer("next_retry_at"),
    error: text("error"),
  },
  (t) => ({
    targetPendingUniq: uniqueIndex("static_rebuild_queue_target_pending_uniq")
      .on(t.target_type, t.target_id)
      .where(sql`status IN ('pending', 'processing')`),
    statusPriorityIdx: index("static_rebuild_queue_status_priority_idx").on(
      t.status,
      t.priority,
      t.created_at,
    ),
    nextRetryIdx: index("static_rebuild_queue_next_retry_idx").on(
      t.status,
      t.next_retry_at,
    ),
  }),
);

// ============================================================
// イベント別カスタム質問 / 回答 (正規化テーブル)
// ============================================================

/**
 * イベントごとのカスタム質問定義。1行 = 1質問。
 * events.custom_questions (旧JSON) は互換用に残すが、新機能の正本はこのテーブル。
 */
export const eventCustomQuestions = sqliteTable(
  "event_custom_questions",
  {
    id: text("id").primaryKey(),
    event_id: text("event_id").notNull(),
    question_key: text("question_key").notNull(),
    label: text("label").notNull(),
    description: text("description"),
    type: text("type", {
      enum: ["text", "textarea", "select", "radio", "checkbox"],
    })
      .notNull()
      .default("textarea"),
    required: integer("required").notNull().default(0),
    options_json: text("options_json"),
    placeholder: text("placeholder"),
    max_length: integer("max_length"),
    sort_order: integer("sort_order").notNull().default(0),
    is_active: integer("is_active").notNull().default(1),
    visibility: text("visibility", {
      enum: ["review", "private", "public"],
    })
      .notNull()
      .default("review"),
    created_at: integer("created_at")
      .notNull()
      .default(sql`(unixepoch())`),
    updated_at: integer("updated_at")
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    eventQuestionKeyUniq: uniqueIndex("event_custom_questions_event_key_uniq")
      .on(t.event_id, t.question_key),
    eventSortIdx: index("event_custom_questions_event_sort_idx").on(
      t.event_id,
      t.sort_order,
    ),
    eventActiveSortIdx: index("event_custom_questions_event_active_sort_idx").on(
      t.event_id,
      t.is_active,
      t.sort_order,
    ),
  }),
);

/**
 * 動画ごとのカスタム質問回答。1行 = 1回答。
 * videos.custom_answers (旧JSON) は互換用に残すが、新機能の正本はこのテーブル。
 */
export const videoCustomAnswers = sqliteTable(
  "video_custom_answers",
  {
    video_id: text("video_id").notNull(),
    event_id: text("event_id").notNull(),
    question_id: text("question_id").notNull(),
    answer_text: text("answer_text"),
    answer_json: text("answer_json"),
    created_at: integer("created_at")
      .notNull()
      .default(sql`(unixepoch())`),
    updated_at: integer("updated_at")
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    primaryKey: primaryKey({
      columns: [t.video_id, t.event_id, t.question_id],
    }),
    videoIdx: index("video_custom_answers_video_idx").on(t.video_id),
    eventIdx: index("video_custom_answers_event_idx").on(t.event_id),
    questionIdx: index("video_custom_answers_question_idx").on(t.question_id),
    videoEventIdx: index("video_custom_answers_video_event_idx").on(
      t.video_id,
      t.event_id,
    ),
  }),
);
