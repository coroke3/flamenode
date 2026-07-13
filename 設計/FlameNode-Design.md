# FlameNode - 詳細設計仕様書 (V8.1 - Cloudflare Native)

## 0. ブランド・プロダクト定義

FlameNode は「映像（フレーム）の結節点（ノード）」を意味する、YouTube 埋め込みを利用した動画プラットフォームである。作品アーカイブ、イベント参加手続き、スロット確保、投稿審査、振り返り上映、第三者イベント開催を一体で扱う。

- **サイト名**: FlameNode
- **中心価値**: 映像作品、作者、イベント、視聴者の接点を継続的に結ぶ
- **動画方式**: YouTube 動画 ID / URL を正規化し、独自プレイヤー UI で包んで表示する
- **イベント方式**: FlameNode 運営イベントだけでなく、許可された第三者イベント開催を容認する
- **主体管理**: Discord ユーザーに複数 X ID を紐づけ、`user.active_x_user_id` を投稿・反応・コメント・チャプターの既定主体とする
- **権限ロール**: 「管理者」と「イベント編集許可者」の2系統を基本とし、イベント単位の補助権限として「協力者」を扱う。管理者は全作品編集、X ID 承認、イベント承認を含む全操作が可能。イベント編集許可者は、許可されたイベントの作品編集権限、イベント説明、枠設定、運営メンバー設定を操作できる。協力者は、付与されたイベントと編集権限キーに限って操作できる。
- **公開UIの基調**: トップページと動画詳細ページは、旧 EventArchives の高コントラスト、高密度な横スクロール作品棚、右レール関連動画、モバイル上部固定プレイヤーをデザインベースにする。黒基調そのものへ必ず準拠する必要はなく、ライトモードとダークモードのテーマトークンを正とする。正式表記や機能は FlameNode として再構成し、トップの巨大ヒーロー化は避け、作品とイベント導線がファーストビューに入る密度を保つ。詳細は `FlameNode-Design-System.md`、`設計app/(public)/page.md`、`設計app/(public)/[id]/page.md` を正とする。

【インフラ構成方針】 本プラットフォームは Cloudflare Pages (Next.js), D1 (SQL DB), R2 (Storage), KV (Cache) を基盤とする。Firebase サービス（Firestore, Auth, Storage, Functions）は、コストとスケーリング最適化のため使用しない。
Cloudflare 無料枠・課金抑制・手動制限の詳細は `FlameNode-Cloudflare-Free-Tier-Guardrails.md` を正とする。無料枠では Workers/Pages Functions requests、Durable Object requests、D1 rows written、KV writes、R2 Class B、Queues operations が特にネックになりやすい。

**命名規則**: テーブル名・カラム名は全て **snake_case** で統一する。Drizzle ORM (`src/lib/db/schema.ts`) を Single Source of Truth とする。

---

## 1. データベース設計 (Cloudflare D1 / SQLite)

Cloudflare D1 (SQLite) を使用し、リレーショナルモデルとして正規化する。
実装上の Single Source of Truth は `src/lib/db/schema.ts` である。この章は説明用の設計資料であり、カラム・index・制約の最終判断は schema.ts と `migrations/*.sql` を正とする。

### 1-0. migration / 旧設計との差分整理方針

`migrations/0000_brave_iceman.sql` は初期スナップショットであり、現在の clean schema は後続 migration で整理されている。古い設計書や初期SQLに残る旧テーブル・旧カラムを新規実装へ戻さない。

- イベント運営権限の正本は `event_staff.permission_preset` / `event_staff.permission_mask` / `event_staff.custom_permission_keys_json`。旧 `event_editors` / `event_collaborator_permissions` は `0019_clean_staff_software_and_disabled_features.sql` で移行・廃止済みとして扱う。
- 作品本体の正本は現行 `videos`。旧 `creator_id`, `owner_discord_user_id`, `submission_type`, `display_name`, `icon_url`, `status`, `is_deleted`, `is_manual_hidden`, `x_reapply_*`, `void_*` へ戻さない。
- 通常コメント用 `video_comments` は `0021_slim_mvp_drop_unused_tables.sql` で削除済み。新規利用しない。チャプター表示は `video_chapters`、メンバー担当チャプターは `video_members.chapters_json` を使う。
- `migrations/meta/_journal.json` は `0007` までしか追跡していない。0010以降は手動SQL migrationを含むため、Drizzle metaだけを正本にしない。

### 1-0. Auth.js 標準テーブル

Auth.js (NextAuth v5) の DrizzleAdapter が必要とするテーブル群。

#### user (Auth.js 標準 + FlameNode 拡張)
- **id**: text (Primary Key / Auth.js UID)
- **name**: text (Auth.js 標準 / Discord 表示名)
- **email**: text | null
- **emailVerified**: integer (timestamp_ms)
- **image**: text (Discord アバター)
- **discord_id**: text UNIQUE (Discord Snowflake ID)
- **role**: text DEFAULT 'user' ("user", "admin", "moderator")
- **is_tos_accepted**: integer (0 or 1) DEFAULT 0
- **accepted_terms_version_id**: text | null (FK → terms_versions.id / 最後に同意した利用規約バージョン)
- **terms_reaccept_required**: integer DEFAULT 0 (利用規約更新後、次回作品投稿・編集保存・提出時に再同意が必要なら1)
- **is_banned**: integer (0 or 1) DEFAULT 0
- **is_notification_enabled**: integer (0 or 1) DEFAULT 1
- **active_x_user_id**: text | null (FK → x_users.id)
- **last_guild_check**: integer (timestamp)
- **created_at**: integer NOT NULL DEFAULT (unixepoch())

#### account (Auth.js 標準)
- **userId**: text (FK → user.id, ON DELETE CASCADE)
- **type**: text
- **provider**: text
- **providerAccountId**: text
- **refresh_token**: text | null
- **access_token**: text | null
- **expires_at**: integer | null
- **Primary Key**: (provider, providerAccountId)

#### session (Auth.js 標準)
- **sessionToken**: text (Primary Key)
- **userId**: text (FK → user.id, ON DELETE CASCADE)
- **expires**: integer (timestamp_ms)

#### verificationToken (Auth.js 標準)
- **identifier**: text
- **token**: text
- **expires**: integer (timestamp_ms)
- **Primary Key**: (identifier, token)

### 1-1. x_users (クリエイター情報)
- **id**: text (Primary Key / X ID @なし)
- **x_name**: text NOT NULL
- **icon_url**: text
- **profile_text**: text
- **portfolio_contact**: text
- **youtube_channel_url**: text
- **other_social_links**: text (JSON)
- **creative_start_date**: integer (timestamp)
- **linked_discord_user_id**: text (FK → user.id)
- **verification_token**: text | null
- **token_expires_at**: integer | null (timestamp)
- **approval_status**: text DEFAULT 'pending' ("pending", "approved", "rejected")
- **approval_requested_at**: integer (timestamp)

### 1-2. x_user_aliases (旧ID履歴)
- **x_user_id**: text (FK → x_users.id)
- **alias_x_id**: text NOT NULL
- **Primary Key**: (x_user_id, alias_x_id)

### 1-3. x_account_link_requests (X ID連携リクエスト)
- **id**: text (Primary Key)
- **discord_user_id**: text NOT NULL (FK → user.id)
- **requested_x_id**: text NOT NULL
- **link_type**: text NOT NULL ("new", "merge", "alias")
- **target_x_user_id**: text | null
- **status**: text DEFAULT 'pending'
- **requested_at**: integer NOT NULL (timestamp)

### 1-4. x_user_icons (アイコン履歴)
- **id**: text (Primary Key)
- **x_user_id**: text NOT NULL (FK → x_users.id)
- **icon_url**: text NOT NULL
- **source_video_id**: text | null (FK → videos.id / 作品由来のアイコン候補)
- **source_type**: text DEFAULT 'video' ("video", "manual", "legacy")
- **created_at**: integer NOT NULL (timestamp)

アイコンは基本的に作品に紐づく候補から選ぶ。代表アイコンは「一番最初の作品」「最新の個人作品」「個人作品がなければ複数人作品」「登録済みアイコン候補から手動選択」を選べるようにする。Cloudflare に新規保存する画像はアイコン画像のみで、元ファイルは1ファイル8MBまでにする。

### 1-5. events (イベント設定)
- **id**: text (Primary Key)
- **title**: text NOT NULL
- **event_type**: text DEFAULT 'event' ("event", "collabo", "type", "other" / 旧 `eventinfo.json.type` 互換)
- **explanation**: text
- **icon_url**: text
- **img_url**: text
- **accent_color**: text | null (イベント別アクセントカラー / HEX)
- **representative_x_user_id**: text | null (FK → x_users.id / イベント代表者)
- **is_active**: integer NOT NULL DEFAULT **0** (★ デフォルト非公開)
- **is_entry_open**: integer NOT NULL DEFAULT 0
- **is_archived**: integer NOT NULL DEFAULT 0 (終了イベントをアーカイブ扱いにする。削除ではなく表示分類で管理)
- **allow_user_video_event_links**: integer NOT NULL DEFAULT 0 (一般ユーザーが既存作品へ追加所属イベントとして選べるか)
- **allow_user_video_edits**: integer NOT NULL DEFAULT 0 (一般ユーザーへイベント単位の作品編集権限を委譲するか)
- **user_video_edit_permission_keys_json**: text | null (委譲する編集 section key の JSON 配列)
- **video_form_settings_json**: text | null (イベント投稿フォーム設定。追加質問、stage_permission 等)
- **event_group_id**: text | null (FK → event_groups.id / イベントのグループ分け)
- **slot_type**: text DEFAULT 'time' ("time", "count" / 時間に紐付く枠と紐付かない枠を区別)
- **slot_visibility_mode**: text DEFAULT 'public_name' ("public_name", "anonymous", "hidden" / 確保者名の公開範囲)
- **start_time**: integer (timestamp)
- **end_time**: integer (timestamp)
- **created_at**: integer NOT NULL DEFAULT (unixepoch())
- **updated_at**: integer NOT NULL DEFAULT (unixepoch())
- **max_slots_per_video**: integer NOT NULL DEFAULT 1
- **max_consecutive_slots_per_entry**: integer NOT NULL DEFAULT 3 (連続取得できる最大枠数。イベントごとに設定)
- **custom_questions**: text (JSON Array)
- **review_settings**: text (JSON Object)
- **editable_fields**: text (JSON Array)
- **repeat_rules**: text (JSON Object) - リピート生成ルール（省略可能）
- **slot_part_gap_minutes**: integer DEFAULT 15 (部を分ける間隔。既存DBに DEFAULT 30 の履歴があるため実値優先、NULL はアプリ側 fallback 15)
- **parts_json**: text | null (作品が選択できる部/カテゴリ候補の JSON 配列)
- **public_api_enabled**: integer NOT NULL DEFAULT 0
- **public_api_updated_at**: integer | null

### 1-5-1. event_groups / event_group_events (イベントグループ)

**正本は `event_group_events`（多対多）。** 1 イベントは複数グループに所属できる。`events.event_group_id` は legacy 列として残るが新規書き込み・読み取り fallback は使わない（`0039` で NULL 化）。

#### event_groups
- **id**: text (Primary Key)
- **name**: text NOT NULL
- **slug**: text NOT NULL UNIQUE
- **description**: text
- **group_type**, **visibility_status**, **sort_order**, 画像・accent 等
- **created_at** / **updated_at**

#### event_group_events
- **event_group_id** + **event_id** (複合 PK)
- **relation_type**: member / primary / related
- **sort_order**

イベントグループは、同一シリーズ、年度、主催単位、企画カテゴリなどでイベントをまとめるために使う。グループ削除時は `event_group_events` も削除する。

### 1-6. event_staff (イベント運営メンバー)
- **id**: text (Primary Key)
- **event_id**: text NOT NULL (FK → events.id)
- **x_user_id**: text | null (FK → x_users.id)
- **discord_user_id**: text | null (FK → user.id)
- **display_name**: text NOT NULL
- **role**: text NOT NULL DEFAULT 'staff' ("representative", "editor", "staff")
- **is_public**: integer NOT NULL DEFAULT 0
- **public_role_label**: text | null
- **internal_note**: text | null
- **approved_by_user_id**: text | null (FK → user.id)
- **approved_at**: integer | null
- **permission_preset**: text NOT NULL DEFAULT 'public_staff' ("owner", "manager", "slot_manager", "content_editor", "reviewer", "xid_reviewer", "public_staff", "custom")
- **permission_mask**: integer NOT NULL DEFAULT 0 (permission key bit mask; max 45 keys)
- **custom_permission_keys_json**: text | null (custom preset only; invalid JSON is treated as [])
- **created_at**: integer NOT NULL DEFAULT (unixepoch())
- **updated_at**: integer NOT NULL DEFAULT (unixepoch())
- **UNIQUE**: (event_id, x_user_id), (event_id, discord_user_id)

イベント運営者・協力者の現在の正本は `event_staff`。旧 `event_editors` と `event_collaborator_permissions` は `0019_clean_staff_software_and_disabled_features.sql` で移行・廃止済みであり、新規実装で参照しない。

### 1-6-1. event_staff_permissions (イベント運営メンバー権限)
- **id**: text (Primary Key)
- **event_staff_id**: text NOT NULL (FK → event_staff.id)
- **permission_key**: text NOT NULL (例: `"event.basic"`, `"event.slots"`, `"event.members"`, `"videos.title"`, `"videos.music_credit"`, `"videos.members"`, `"videos.review_data"`, `"videos.youtube_id"`, `"videos.primary_event"`, `"video.chapter_admin"`)
- **allowed**: integer NOT NULL DEFAULT 1
- **created_at**: integer NOT NULL DEFAULT (unixepoch())
- **updated_at**: integer NOT NULL DEFAULT (unixepoch())
- **UNIQUE**: (event_staff_id, permission_key)

`event_staff_permissions` は移行元としてのみ残し、新規書き込みしない。新規書き込み・権限判定・表示は `event_staff.permission_preset` / `event_staff.permission_mask` / `event_staff.custom_permission_keys_json` を正本にする。

### 1-7. slots (予約枠)
- **id**: text (Primary Key)
- **event_id**: text NOT NULL (FK → events.id)
- **discord_user_id**: text | **null** (FK → user.id) ★ 空きスロットは NULL
- **x_user_id**: text | **null** (FK → x_users.id / 実際に枠を確保したクリエイター名義。承認待ちIDも許容)
- **display_name**: text
- **slot_kind**: text DEFAULT 'time' ("time", "count" / 時間あり枠か時間なし枠か)
- **slot_label**: text | null (時間なし枠や管理用の表示名)
- **start_time**: integer | null (timestamp / 時間なし枠では NULL)
- **end_time**: integer (timestamp)
- **sort_order**: integer DEFAULT 0
- **reservation_group_id**: text | null (連続枠取得時の同一予約グループ)
- **priority_reclaim_video_id**: text | null (X ID 却下等で解放された後、元投稿者へ24時間だけ優先再取得を案内する対象作品)
- **priority_reclaim_until**: integer | null (優先再取得期限。期限後は通常の空き枠として扱う)
- **video_id**: text (FK → videos.id)
- **status**: text NOT NULL DEFAULT 'available' ("available", "reserved", "submitted")
- **updated_at**: integer NOT NULL DEFAULT (unixepoch())

`discord_user_id` は「どのDiscordアカウントが操作したか」を残すシステム上の主体、`x_user_id` は「どのクリエイター名義で枠を取ったか」を示す公開・作品管理上の主体とする。枠確保時は `user.active_x_user_id` を `slots.x_user_id` に保存し、`approval_status = "pending"` の X ID でも確保を許可する。管理者がその X ID を却下した場合、受付中イベントに属する未提出の `slots` だけを `status = "available"` に戻し、`discord_user_id`, `x_user_id`, `display_name` を NULL にして即時解放する。自動解放された元枠は24時間だけ `priority_reclaim_video_id` と `priority_reclaim_until` で元投稿者へ優先再取得導線を出す。ただし公開ページでは承認待ちや却下理由を表示せず、枠が空きとして反映される目標時間は10分以内とする。提出済み作品に紐づく枠は自動解放せず、`video_moderation_cases.case_type = "x_reapply"` の open case として保持し、ユーザーへ X ID 再申請と枠の取り直しを促す。終了した企画、募集終了した企画、提出済み作品に紐づく枠は履歴保持を優先し、自動解放しない。

枠の代理確保は管理者と当該イベントのイベント編集許可者が実行できる。X ID 却下後の枠取り直しでは、元の `reservation_group_id` を新しい予約へ引き継がない。旧枠との関連は `history_logs` に旧 slot ID、新 slot ID、対象 video ID、操作主体を残し、管理者だけが確認できるようにする。

優先再取得中の元枠は、一般ユーザーには「選択不可の空き（確保処理中）」として表示し、「この枠は現在、優先再取得手続き中のため選択できません」と説明する。管理者と当該イベントのイベント編集許可者は、イベント進行調整のため、優先再取得中でも代理割り当てできる。枠取り直し画面では元枠と同じ日付・時間帯の周辺を優先表示し、元枠が取れない場合は代替枠があれば表示し、なければ代替なしとして扱う。時間ありスロットの連続取得は他者の枠と隣接していても問題なしとし、時間なしスロットの連続判定は内部ソート順・番号連番で行う。既存の確保済み予約は、後から最大連続取得数を変更しても無効化しない。代理確保時は本人への通知を必須にする。受付終了後の例外的な枠取り直しは、管理者と当該イベントのイベント編集許可者だけが操作できる。

### 1-8. videos (作品情報)
- **id**: text (UUID Primary Key)
- **primary_event_id**: text (FK → events.id)
- **creator_x_user_id**: text | null (FK → x_users.id / 作者 X ID)
- **submitted_by_discord_user_id**: text NOT NULL (投稿操作を行った Discord ユーザー)
- **collaboration_type**: text NOT NULL DEFAULT 'individual' ("individual", "collab")
- **part**: text | null (イベントの `parts_json` から選ぶ部/カテゴリ)
- **source_type**: text NOT NULL DEFAULT 'youtube' ("youtube", "manual", "external")
- **creator_display_name**: text NOT NULL
- **creator_display_name_yomi**: text | null
- **creator_icon_url**: text | null
- **title**: text NOT NULL
- **music**: text
- **credit**: text
- **music_reference_url**: text
- **closing_comment**: text
- **youtube_video_id**: text
- **stage_permission**: text
- **intro_comment**: text
- **highlights**: text
- **production_story**: text
- **custom_answers**: text (JSON Object / event_id keyed)
- **visibility_status**: text NOT NULL DEFAULT 'draft' ("draft", "pending", "public", "limited", "private", "hidden", "archived", "voided")
- **scheduling_type**: text DEFAULT 'slotted' ("slotted", "manual")
- **scheduled_time**: integer (timestamp)
- **used_software_json**: text | null
- **app_like_count**: integer NOT NULL DEFAULT 0
- **score**: real NOT NULL DEFAULT 0
- **trending_view_count_24h**: integer NOT NULL DEFAULT 0
- **score_updated_at**: integer | null
- **created_at**: integer NOT NULL DEFAULT (unixepoch())
- **updated_at**: integer NOT NULL DEFAULT (unixepoch())

旧 `creator_id` は `creator_x_user_id`、旧 `owner_discord_user_id` は `submitted_by_discord_user_id`、旧 `display_name` / `icon_url` は `creator_display_name` / `creator_icon_url` に整理済み。旧 `status`, `is_deleted`, `is_manual_hidden`, `unlisted` は `visibility_status` に統合する。YouTube側の限定公開状態は FlameNode の `visibility_status='limited'` とは別概念で、`video_youtube_metadata.youtube_privacy_status` で扱う。

`submitted_by_discord_user_id` は投稿操作の記録であり、単独では作品編集権限を与えない。編集権限は承認済み `creator_x_user_id`、管理者、イベント運営権限、`video_members.can_edit` の共同編集権限から判定する。

X ID 再申請や void 理由などのケース情報は `videos.x_reapply_*` / `videos.void_*` ではなく `video_moderation_cases` に分離する。公開・一覧・スコアからの除外は `visibility_status='voided'` を正とする。

`app_like_count`, `score`, `trending_view_count_24h`, `score_updated_at` は 0024 以降の表示用統計正本。`video_stats` は score-recalc worker と旧DB fallback 用に当面残すが、新規表示クエリでは `videos.score` を優先する。

#### visibility_status

| 値 | 意味 |
|---|---|
| `draft` | 下書き |
| `pending` | 承認・公開待ち |
| `public` | 公開一覧に出す |
| `limited` | 直接 URL または限定導線のみ |
| `private` | 非公開 |
| `hidden` | 管理上の手動非表示 |
| `archived` | 通常導線から除外 |
| `voided` | 無効化。公開・上映・一覧・エクスポート・スコア上は除外 |

`scheduled_time` は作品の代表上映時刻であり、枠あり投稿では紐づくスロット群のうち最初の `slots.start_time` をコピーする。連続枠のまとまりは `slots.reservation_group_id` で管理する。

### 1-8-1. video_youtube_metadata
- **video_id**: text (Primary Key / FK → videos.id)
- **youtube_video_id**: text | null
- **youtube_privacy_status**: text | null
- **youtube_availability_status**: text | null
- **duration_seconds**: integer | null
- **view_count**: integer NOT NULL DEFAULT 0
- **synced_at**: integer | null
- **sync_status**: text NOT NULL DEFAULT 'pending' ("pending", "synced", "failed")
- **sync_error**: text | null
- **updated_at**: integer NOT NULL

### 1-8-2. video_stats
- **video_id**: text (Primary Key / FK → videos.id)
- **app_view_count**: integer NOT NULL DEFAULT 0
- **app_like_count**: integer NOT NULL DEFAULT 0
- **trending_view_count_24h**: integer NOT NULL DEFAULT 0
- **score**: real NOT NULL DEFAULT 0
- **updated_at**: integer NOT NULL

`video_stats` は即削除しない。`score-recalc` worker が `video_stats` と `videos.score` を同期し、旧DBでは `video_stats` へ fallback する。

### 1-8-3. video_moderation_cases
- **id**: text (Primary Key)
- **video_id**: text NOT NULL (FK → videos.id)
- **case_type**: text NOT NULL ("x_reapply", "void", "duplicate", "rights", "operator")
- **status**: text NOT NULL DEFAULT 'open' ("open", "resolved", "rejected", "expired", "cancelled")
- **public_reason**: text | null
- **private_note**: text | null
- **due_at**: integer | null
- **locked_until**: integer | null
- **attempt_count**: integer NOT NULL DEFAULT 0
- **related_x_user_id**: text | null
- **created_by_user_id**: text | null
- **resolved_by_user_id**: text | null
- **created_at**: integer NOT NULL
- **resolved_at**: integer | null

<!--
旧設計メモ:
- creator_id → creator_x_user_id
- owner_discord_user_id → submitted_by_discord_user_id
- submission_type → collaboration_type / source_type
- display_name / icon_url → creator_display_name / creator_icon_url
- status / is_deleted / is_manual_hidden → visibility_status
- x_reapply_* / void_* → video_moderation_cases
-->

### 1-9. video_events (所属イベント)
- **video_id**: text (FK → videos.id, ON DELETE CASCADE)
- **event_id**: text (FK → events.id, ON DELETE CASCADE)
- **Primary Key**: (video_id, event_id)

### 1-10. video_members (合作メンバー)
- **id**: text (Primary Key)
- **video_id**: text NOT NULL (FK → videos.id, ON DELETE CASCADE)
- **x_user_id**: text | null (FK → x_users.id)
- **name**: text NOT NULL
- **role**: text
- **comment**: text
- **order_index**: integer NOT NULL DEFAULT 0
- **chapters_json**: text | null (メンバー担当チャプターの JSON)
- **discord_user_id**: text | null
- **can_edit**: integer NOT NULL DEFAULT 0
- **is_public_member**: integer NOT NULL DEFAULT 1
- **edit_granted_by_user_id**: text | null
- **edit_granted_at**: integer | null
- **edit_updated_at**: integer | null

`video_members` は公開メンバー表示、非公開共同編集者、メンバー担当チャプター、共同編集権限を同居させる。旧 `video_collaborators` / `video_collaborator_permissions` / `video_member_chapters` は中間設計であり、現在は `video_members.can_edit` と `video_members.chapters_json` が正本。

### 1-11. history_logs (履歴)
- **id**: integer (Primary Key AUTOINCREMENT)
- **table_name**: text NOT NULL
- **record_id**: text NOT NULL
- **action**: text NOT NULL ("CREATE", "UPDATE", "DELETE")
- **before_data**: text (JSON)
- **after_data**: text (JSON)
- **operator_discord_id**: text
- **created_at**: integer NOT NULL DEFAULT (unixepoch())

### 1-12. system_settings (全体設定)
- **id**: text (Primary Key: "default")
- **default_editable_fields**: text (JSON Object: {"title": boolean, "music": boolean, ...})
- **upcoming_editable_fields**: text (JSON Object) - 枠あり/未公開作品用のデフォルト編集許可設定
- **history_retention_days**: integer DEFAULT 90
- **operation_mode**: text DEFAULT "normal" ("normal", "economy", "read_only", "static_only", "maintenance")
- **disabled_features_json**: text (JSON Array / 手動停止中の機能)
- **cost_guard_reason**: text | null
- **cost_guard_updated_by_user_id**: text | null
- **cost_guard_updated_at**: integer | null
- **cost_guard_exception_until**: integer | null (管理者一時許可の終了時刻。設定時刻から厳密に15分)
- **cost_guard_exception_features_json**: text (JSON Array / 一時許可する機能)

### 1-13. api_endpoints (旧システム互換エンドポイント)
- **id**: text (Primary Key)
- **event_id**: text NOT NULL (FK → events.id)
- **is_active**: integer DEFAULT 1
- **created_at**: integer NOT NULL (timestamp)

### 1-14. video_interactions (いいね・ブックマーク)
- **id**: text (Primary Key)
- **x_user_id**: text NOT NULL (FK → x_users.id, ON DELETE CASCADE)
- **video_id**: text NOT NULL (FK → videos.id, ON DELETE CASCADE)
- **interaction_type**: text NOT NULL ("like", "bookmark")
- **source**: text DEFAULT 'app' ("app", "youtube")
- **created_at**: integer NOT NULL (timestamp)
- **synced_at**: integer | null (timestamp)
- **UNIQUE**: (x_user_id, video_id, interaction_type)

### 1-15. video_comments (削除済み)

`video_comments` は `0021_slim_mvp_drop_unused_tables.sql` で削除済み。新規 UI / API / Worker / migration で利用しない。
通常コメント機能は MVP では持たず、作品の時刻付き情報は `video_chapters`、メンバー担当チャプターは `video_members.chapters_json` に寄せる。

### 1-16. video_chapters (チャプター/時間付きコメント用マーカー)
- **id**: text (Primary Key)
- **video_id**: text NOT NULL (FK → videos.id, ON DELETE CASCADE)
- **x_user_id**: text NOT NULL (FK → x_users.id, ON DELETE CASCADE)
- **video_member_id**: text | null (deprecated / メンバー担当チャプターは `video_members.chapters_json` が正本)
- **chapter_time**: real NOT NULL (秒)
- **chapter_label**: text NOT NULL
- **note**: text
- **visibility**: text DEFAULT 'public' ("private", "public")
- **marker_kind**: text DEFAULT 'comment' ("comment", "chapter", "review", "system")
- **show_on_player_bar**: integer DEFAULT 0
- **order_index**: integer DEFAULT 0
- **created_at**: integer NOT NULL (timestamp)
- **updated_at**: integer NOT NULL (timestamp)

時間付き情報は YouTube 風の独立コメント欄ではなく、チャプター/メモとして扱う。ユーザーは任意の秒数を手動設定でき、自分のチャプター一覧を確認し、公開/非公開を切り替えられる。他ユーザーの公開チャプターは閲覧できる。`video_comments` への紐づけは行わない。

`marker_kind = 'chapter'` の行、または `show_on_player_bar = 1` の公開行は、独自プレイヤーの再生バー上にチャプターマーカーとして点表示できる。通常コメント由来のチャプターは再生バーを混雑させないため `show_on_player_bar = 0` を既定とし、明示的なチャプター指定時のみ `show_on_player_bar = 1` を初期値にする。過去データの `starts` / `ends` など秒数指定がある情報は、管理インポート時に `marker_kind = 'chapter'` の初期候補として取り込む。

### 1-17. custom_pages (ポートフォリオ)
- **id**: text (Primary Key)
- **x_user_id**: text NOT NULL (FK → x_users.id, ON DELETE CASCADE)
- **html**: text
- **css**: text
- **theme_id**: text | null
- **shortcode_version**: text
- **is_published**: integer DEFAULT 0
- **updated_at**: integer NOT NULL (timestamp)

### 1-18. custom_themes (テンプレート)
- **id**: text (Primary Key)
- **name**: text NOT NULL
- **author**: text
- **description**: text
- **preview_image**: text
- **template_html**: text
- **template_css**: text
- **created_at**: integer NOT NULL (timestamp)
- **is_default**: integer DEFAULT 0

### 1-19. recommendation_signals (推薦シグナル)
- **id**: text (Primary Key)
- **x_user_id**: text NOT NULL (FK → x_users.id, ON DELETE CASCADE)
- **video_id**: text NOT NULL (FK → videos.id, ON DELETE CASCADE)
- **watch_seconds**: real DEFAULT 0
- **like_score**: real DEFAULT 0
- **bookmark_score**: real DEFAULT 0
- **updated_at**: integer NOT NULL (timestamp)

### 1-20. x_id_merge_requests (X ID統合)
- **id**: text (Primary Key)
- **from_x_user_id**: text NOT NULL (FK → x_users.id)
- **to_x_user_id**: text NOT NULL (FK → x_users.id)
- **requested_by_uid**: text NOT NULL (FK → user.id)
- **status**: text DEFAULT 'pending' ("pending", "approved", "rejected", "done")
- **created_at**: integer NOT NULL (timestamp)
- **updated_at**: integer NOT NULL (timestamp)

### 1-21. notification_outbox (通知キュー)
- **id**: text (Primary Key)
- **discord_user_id**: text NOT NULL (FK → user.id, ON DELETE CASCADE)
- **type**: text NOT NULL
- **payload_json**: text NOT NULL
- **status**: text DEFAULT 'pending' ("pending", "processing", "sent", "failed")
- **attempt_count**: integer DEFAULT 0
- **next_attempt_at**: integer (timestamp)
- **last_error**: text
- **created_at**: integer NOT NULL DEFAULT (unixepoch())

### 1-22. dashboard_metrics_cache (ダッシュボード統計キャッシュ)
- **id**: text (Primary Key: "global")
- **total_users**: integer DEFAULT 0
- **total_videos**: integer DEFAULT 0
- **active_users_last_5m**: integer DEFAULT 0
- **new_videos_last_24h**: integer DEFAULT 0
- **updated_at**: integer NOT NULL (timestamp)

### 1-23. x_id_merge_reverts (X ID統合取消)
- **id**: text (Primary Key)
- **merge_request_id**: text NOT NULL (FK → x_id_merge_requests.id)
- **requested_by_uid**: text NOT NULL (FK → user.id)
- **status**: text DEFAULT 'pending' ("pending", "approved", "rejected", "done")
- **restore_snapshot_json**: text NOT NULL
- **revert_deadline_at**: integer NOT NULL (timestamp / 統合完了から180日後)
- **created_at**: integer NOT NULL (timestamp)
- **updated_at**: integer NOT NULL (timestamp)

### 1-24. Cloudflare 使用量の運用 (D1テーブルなし)

Cloudflare 使用量を収集する実装がないため、推定値や使用量スナップショットを D1 に保存しない。運用者が Cloudflare Dashboard を確認し、必要に応じて `/admin/cost-guard` から `operation_mode` を手動変更する。

### 1-25. terms_versions (利用規約バージョン)
- **id**: text (Primary Key)
- **version_label**: text NOT NULL
- **body_markdown**: text NOT NULL
- **status**: text DEFAULT 'draft' ("draft", "published", "archived")
- **published_at**: integer | null (timestamp)
- **created_by_user_id**: text NOT NULL (FK → user.id)
- **created_at**: integer NOT NULL DEFAULT (unixepoch())
- **updated_at**: integer NOT NULL DEFAULT (unixepoch())

利用規約は管理者が管理画面で編集し、公開バージョンを1つだけ有効にする。公開済み規約を変更する場合は既存本文を直接上書きせず、新しいバージョンを作成して公開する。

### 1-26. user_tos_consents (利用規約同意履歴)
- **id**: text (Primary Key)
- **user_id**: text NOT NULL (FK → user.id, ON DELETE CASCADE)
- **terms_version_id**: text NOT NULL (FK → terms_versions.id)
- **consented_at**: integer NOT NULL (timestamp)
- **consent_context**: text NOT NULL ("entry", "post", "edit", "admin")

規約更新後、既存ユーザーには次回の作品投稿、作品編集保存、提出時に再同意を求める。スロット確保だけでは原則ブロックしないが、投稿・提出へ進む前に最新規約への同意を必須にする。

### 1-27. software_catalog (編集ソフト辞書)
- **id**: text (Primary Key)
- **name**: text NOT NULL
- **normalized_name**: text NOT NULL UNIQUE
- **category**: text | null
- **created_at**: integer NOT NULL DEFAULT (unixepoch())
- **updated_at**: integer NOT NULL DEFAULT (unixepoch())

### 1-28. software_aliases (編集ソフト別名)
- **id**: text (Primary Key)
- **software_id**: text NOT NULL (FK → software_catalog.id, ON DELETE CASCADE)
- **alias**: text NOT NULL
- **normalized_alias**: text NOT NULL
- **UNIQUE**: (software_id, normalized_alias)

汎用分類ラベル機能は採用しない。作品の属性分類としてのラベル入力、ラベル検索、ラベル別インデックスは設計から外す。使用編集ソフトだけはチップ型の入力体験にし、辞書と別名で「After Effects」「AE」「AviUtl」などの表記ゆれを候補提示・標準名寄せする。

---

## 2. 実装仕様の詳細解説

### 2-1. イベント・枠・作品の永続性
`slots` と `videos` は疎結合とする。`videos` 作成時に、単枠なら対象 `slots.start_time`、連続枠なら同じ `reservation_group_id` の最初の `slots.start_time` を `scheduled_time` にコピー（非正規化）する。イベント終了後もイベント、枠、作品は削除せず、`events.is_archived` と公開状態でアーカイブ表示へ移す。終了イベントに紐づく作品も残し、旧形式エクスポート、イベント詳細、動画詳細の文脈表示で参照できるようにする。

時間に紐付くスロットは、日付・時間・空き状況が1対1で見える予約表として扱う。複数枠取得は連続する空き枠のみに限定し、最大取得数は `events.max_consecutive_slots_per_entry` でイベントごとに設定する。時間に紐付かないスロットは、番号やラベルと空き状況だけが分かればよい簡易枠として扱う。

### 2-2. フォーム入力画面のフローと要件
情報入力の項目を「エントリー時に必須の項目」と「後から入力・更新可能な項目」に分離し、UIのステップを分ける。詳細は `/dashboard/post/page.md` を参照。

### 2-3. カスタム質問項目の動的生成
イベントごとに固有の質問を設定可能。エントリー時または振り返り時に入力を要求し、回答は `videos.custom_answers` に保存される。

**JSON スキーマ仕様**:
```json
// events.custom_questions の構造例
[
  {
    "id": "software",
    "label": "使用ソフト",
    "type": "text",
    "required": true,
    "placeholder": "例: Blender, After Effects"
  },
  {
    "id": "genre",
    "label": "ジャンル",
    "type": "select",
    "required": true,
    "options": ["Music Video", "Dance", "Animation", "その他"]
  },
  {
    "id": "collab_note",
    "label": "合作について",
    "type": "textarea",
    "required": false,
    "placeholder": "合作の意図や分工の内容を記載"
  }
]

// videos.custom_answers の構造例
{
  "software": "Blender",
  "genre": "Music Video",
  "collab_note": "ダンス動画とのクロスオーバー合作"
}
```

**マッピングルール**:
- `custom_answers` のキーは `custom_questions[].id` と完全に一致する
- `required: true` の質問に回答がない場合、サーバーサイドでバリデーションエラーを返す
- 質問構造はイベント作成時に変更可能。既存の回答は破棄されない（後方互換性）

### 2-4. 枠あり登録 と 枠なし登録 の分離
- **枠あり登録**: `slots` カレンダーから選択。
- **枠なし登録 (Archive)**: ユーザーが任意の「過去の公開日時」を指定。

### 2-5. ハイブリッドIDルーティング・正規化
公開ページ (`/[id]`) では、UUID と YouTubeID の双方を受け入れ、YouTubeID 登録済みなら UUID アクセスを YouTubeID 形式の URL へ HTTP 308 転送して正規化する。

### 2-6. X ID・名前の相互変換ツールの統合
メンバー入力時に、過去のデータをルックアップしてサジェスト。ID 変更があった場合でも同一クリエイターとして識別する。

詳細な旧データ互換、`eventinfo.json`、名前・ID変換、CSV プロンプト仕様は `FlameNode-Legacy-Data-Compatibility.md` を正とする。

- **入力形式**: 名前、X ID、またはカンマ区切りの複数値を受け付ける。縦に貼り付けられた表データは、改行をカンマ区切りへ変換して候補検索に渡す。
- **変換モード**: 「名前から ID」「ID から名前」「通常検索」の3モードを持つ。通常検索では名前・ID のどちらでも部分一致と類似検索を行う。
- **参照データ**: `x_users.id`, `x_users.x_name`, `x_user_aliases.alias_x_id`, `video_members.name`, `video_members.x_user_id`, 旧データ由来の `creator/tlink`, `member/memberid` 対応表を統合して候補化する。
- **類似判定**: 完全一致を最優先し、部分一致、読み替え、レーベンシュタイン距離による類似度を併用する。複数候補がある場合は信頼度を表示し、ユーザーが手動選択できるようにする。
- **自動選択基準**: 完全一致が1件のみなら自動選択する。ID 一致や非常に高い類似度の候補が複数ある場合は、自動確定せず候補リストとして表示する。
- **未登録候補**: 該当 ID が `x_users` に存在しない場合でも、手動入力として `x_user_id: null` または承認待ち X ID として保存できる。
- **利用箇所**: 投稿フォーム、作品編集、イベント運営メンバー設定、イベント協力者権限設定、CSV インポートプレビューで共通利用する。

#### 相互変換ロジックの完結仕様
- **正規化**: 入力値は前後空白を削除し、連続空白を1つにまとめ、X ID 先頭の `@` を除去し、小文字比較用の値を作る。表示値は元の大文字小文字を保持する。
- **データ展開**: 旧 `video.json` 由来の `creator/tlink` を1組、`member/memberid` をカンマ区切りの複数組として展開する。`member` と `memberid` の件数が合わない場合は、存在するインデックスだけ候補化し、不足分は未確定候補として表示する。
- **検索対象**: `creator`, `tlink`, `member`, `memberid`, `x_users.x_name`, `x_users.id`, `x_user_aliases.alias_x_id`。
- **通常検索**: 名前または ID の部分一致を行い、同じ `name + id` の候補は1件に重複排除する。
- **名前からID**: 入力名と候補名を比較し、最も近い候補の X ID を出す。
- **IDから名前**: 入力IDと候補IDを比較し、最も近い候補の名前を出す。
- **類似度**: レーベンシュタイン距離を使い、`similarity = (1 - distance / longer_length) * 100` で算出する。30%以下は候補から除外し、候補は類似度降順で最大10件表示する。
- **自動選択**: 完全一致が1件のみなら自動選択する。80%以上の候補が複数ある場合は自動確定せず、候補リストから選ばせる。50%以上の候補がある場合は低信頼候補として薄い警告背景で表示する。
- **信頼度表示**: 完全一致は高信頼、80%以上は中〜高信頼、50%以上は要確認、手動入力は低信頼として表示する。
- **縦データ変換**: 表計算ソフトから縦に貼り付けられたデータは、空行を除去してカンマ区切りへ変換し、変換結果をコピーできるようにする。
- **手動補正**: 候補がない場合、または候補が誤っている場合は手動入力を許可する。手動入力は信頼度を低く表示し、後から X ID 承認・統合で補正できるようにする。

### 2-7. ページ別の表示条件
- **/list**: `videos.visibility_status = "public"` の全作品。`voided` / `archived` / `hidden` / `private` は除外する。
- **/event/[id]**: 該当イベントの参加作品。

### 2-8. 履歴ログの保持期間と一括削除
- **通常ログ**: 90日間。Cron Triggers (`cleanup` Worker) により自動削除候補にする。
- **長期ログ**: X ID 再申請、X ID 却下、枠解放、`voided`、復旧、通知送信失敗、コストガード操作は監査上重要なため180日保持する。実装上は別テーブル、または `history_logs.retention_class = "long_audit"` 相当の属性で分ける。
- **閲覧範囲**: 管理者は全ログを確認できる。イベント編集許可者は担当イベント内に限り、イベント設定、作品、枠、協力者権限、X ID 再申請 case、`voided` 要請に関するログを確認できる。担当外ユーザーのメールアドレス、Discord 連携詳細、他イベント予約詳細はマスクする。
- **危険操作**: `voided`、復旧、物理削除候補処理、コストガード一時許可、ステータス強制整合は理由入力必須とし、復旧操作自体も新しい監査ログとして残す。

### 2-9. 枠のリピート一括生成と多重生成ロジック
- **多重セッション生成**: 異なるルール（間隔等）を順次適用。
- **排他制御**: CAS パターンを使用してダブルブッキングを物理的に防止（TECHNICAL_SPEC §3.1 参照）。

### 2-10. 条件付き自動公開 (Auto-Public) システム
- **ステートマシン**: 通常は `draft` → `pending` → `public` → `limited`/`private`/`hidden`。公開可否は `videos.visibility_status` を正とし、X ID 再申請や無効化理由は `video_moderation_cases` で管理する。
- **Golden Record**: 必須項目 + YouTube 健全性が確認された瞬間に `videos.visibility_status = "public"` へ自動更新。
- **Manual Kill Switch**: 運営による事後差し止めは `videos.visibility_status = "hidden"` または `"voided"` と `video_moderation_cases` で記録する。
- **差し戻し**: `public` → `unlisted` + `last_error` へのコメント記録。専用の `returned` ステータスは使用しない。

**トリガー仕様**:
- **Submit 時即時チェック**: Server Action（動画保存時）で以下の必須チェックを即時実行
  1. `videos.submitted_by_discord_user_id` ≠ NULL（Discord 認証済み）
  2. `videos.creator_x_user_id` ≠ NULL（X クリエイター登録済み）
  3. `x_users.approval_status` = `'approved'`（クリエイター承認済み）
  4. `user.is_banned` = false（BANされていない）
  5. `user.accepted_terms_version_id` が最新公開規約を指す（利用規約同意済み）
  6. 必須フィールド（`title`, `creator_display_name`）が埋まっている
- **全チェック合格時**: 即時 `videos.visibility_status = 'public'` に更新。YouTube URL / ID が入力されたタイミング、保存時、提出時に軽量な即時同期を試行し、成功した場合は `video_youtube_metadata.sync_status = 'synced'` にする。一時的な取得失敗またはクォータ節約で保留した場合のみ `pending` とし、`youtube-sync` Worker の定期同期へ回す。削除済みや存在確認失敗が明確な場合は `failed` としてユーザー修正待ちにする。
- **X Link 必須**: `videos.creator_x_user_id` が紐づく `x_users.approval_status` が `'approved'` でない場合、`videos.visibility_status = 'pending'` のまま。クリエイター承認後に再チェック用キューを `notification_outbox` に登録
- **YouTube 検証**: `youtube-sync` Worker が `video_youtube_metadata.sync_status = 'pending'` の動画を6時間ごとにスキャン。存在確認できたら `video_youtube_metadata.sync_status = 'synced'` に更新する。ユーザー本人は自分の作品に限り、1作品につき1日1回まで「YouTube情報を再同期」を押せる。手動同期は管理者のクォータガードと `read_only` 状態を尊重し、クォータ枯渇時はキュー投入だけに留める。

### 2-11. 旧システム互換JSONの出力仕様
- **R2 エクスポート**: Cron Triggers (`json-generator` Worker) で JSON を R2 に静的書き出し。外部ツールは R2 を参照することで D1 負荷をゼロ化。
- **動画旧形式**: `videos`, `video_members`, `events`, `x_users` から旧 `video.json` 相当を再生成する。`title`, `creator`, `tlink`, `icon`, `time`, `timestamp`, `ylink`, `music`, `credit`, `member`, `memberid`, `beforecomment`, `aftercomment`, `soft`, `hitokoto`, `type1` など、旧ツールが参照するキーを保持する。
- **イベント旧形式**: `events` と `event_staff` から旧 `eventinfo.json` 相当を再生成する。`eventid`, `start`, `end`, `type`, `icon`, `eventname`, `member`, `memberid`, `menberpost`, `explanation`, `img` を出力する。旧キーの誤字 `menberpost` は互換性のため維持し、同内容の `memberpost` を追加出力してもよい。
- **ID・名前対応表**: `x_users`, `x_user_aliases`, `video_members`, `event_staff` から名前・ID の相互変換に使える CSV/JSON を出力する。
- **出力対象**: 通常エクスポートは公開データのみ。管理者向け詳細エクスポートは限定公開・非公開・管理画面専用メンバーも含められる。外部上映ツール向けはこの方針でよく、限定公開作品は管理者向け詳細エクスポートまたは専用スコープで扱う。X ID 再申請 case が open の作品は運営向け詳細レポートには状態フラグ付きで出力し、旧形式の上映・再生用出力からは除外する。`voided` は監査・統計専用の別レポートにだけ出す。
- **文字コード**: JSON と旧出力は UTF-8 を正とする。旧データに文字化けが残る場合は、Shift_JIS、Windows-31J、UTF-8 の取り違えを疑う。システムは疑い行をハイライトし、修正候補を補助表示する。管理者は確認画面で手動修正できるが、必須にはせず、一括スキップして原文のまま取り込むこともできる。
- **旧データの画像URL**: `icon`, `img` などの外部画像 URL は Cloudflare へ保存せず参照のみで保持する。Cloudflare に保存する画像は新規アイコン画像だけに限定する。
- **旧データのX ID**: 旧データ内の X ID は未承認 X ID（プレースホルダー）として作成し、将来の本人確認・統合・付け替えに備える。旧データ由来の運営メンバー公開範囲が不明な場合は非公開（管理画面のみ）を既定にする。

### 2-12. YouTube API 更新ポリシー
- **Lazy Update**: 動画ページアクセス時にバックグラウンドで更新。
- **バッチ同期**: `youtube-sync` Worker が6時間ごとに50件ずつ同期。
- **入力時同期**: 投稿・編集フォームで YouTube URL / ID が入力された時点で、11桁IDの正規化、サムネイルURL生成、公開状態・存在確認を即時に試行する。成功すればフォーム上に確認済み表示を出し、ユーザーが投稿直後に状態を確認できるようにする。
- **ユーザー手動同期**: ログインユーザーは、自分が所有する作品について1作品につき1日1回まで同期要求できる。上限は日本時間 0:00 にリセットする。同期要求は `video_youtube_metadata.sync_status`, 最終要求日、要求者を記録し、連打やクォータ消費を防ぐ。クォータ不足時はキュー投入のみとし、即時同期は保証しない。
- **管理者・イベント編集許可者の同期**: 管理者と担当イベントのイベント編集許可者による手動同期は、通常ユーザーの1日1回制限の対象外にする。ただし YouTube API クォータと `operation_mode` は尊重し、枯渇時はキュー投入に留める。
- **クォータ不足時の再実行**: YouTube API クォータ不足で同期できなかったキューは、翌日の日本時間 0:00 以降に自動再実行する。
- **URL種別**: Shorts URL、通常URL、共有URLはいずれも最終的に11桁の YouTube 動画 ID へ正規化して管理する。
- **公開状態**: 非公開動画は「YouTube側の公開設定を確認してください」と本人へ表示する。削除済みまたは存在確認失敗は `video_youtube_metadata.sync_status = "failed"` とし、`pending` へ戻さず、YouTube 側の復旧または URL 修正を待つ。
- **登録許容**: プレミア公開待ち動画、年齢制限付き動画、埋め込み不可動画は登録自体をブロックしない。プレミア公開を順に追うイベントを想定し、埋め込み不可の場合は外部で開く導線や警告を出す。
- **OGPフォールバック**: YouTube API の1日上限クォータを90%消費した時点で、新規の軽量確認は OGP 解析へ自動的に切り替える。OGPから取得したタイトル・サムネイル・公開予定時刻は確認・提案用に留め、ユーザー入力済みのタイトルや説明文を勝手に上書きしない。
- **埋め込み不可・年齢制限**: 埋め込み不可または年齢制限付きで iframe 再生ができない場合、プレイヤー中央に YouTube サムネイルと「YouTubeで視聴する」の外部リンクボタンを大きく表示し、タイトル直下にも同じ導線を置く。
- **プレミア公開待ち**: OGP または YouTube API から公開予定時刻が取れる場合のみ、簡易テキストのカウントダウンを表示する。取得できない場合は通常の待機表示に留める。
- **再生数同期**: YouTube 側再生数は既定で6時間ごとのバッチで同期する。取得失敗時は前回値を維持し、補正係数は掛けない。YouTube API のクォータ上限は管理画面のシステム設定で手入力できる。
- **手動同期履歴**: ユーザー本人には直近1回の同期結果（成功/失敗日時と簡単な理由）のみ表示し、詳細履歴は管理画面と監査ログで扱う。
- **動画ID変更時**: YouTube ID を差し替えても既存チャプターやコメントの秒数は維持し、範囲外になったチャプターは一覧で「無効（範囲外）」としてグレーアウトする。範囲外チャプターは再生バーの点表示から除外する。

### 2-13. 履歴データの復元ロジック
- **Restoration**: `history_logs` の JSON スナップショットを元に行単位で復元。

### 2-14. 通知システム
- **Discord DM 主軸**: Bot による DM 通知を主軸とする。
- **Outbox パターン**: `notification_outbox` テーブル + Cron Worker (5分間隔) で確実に送信。
- **再送**: DM 通知は最大3回、指数バックオフで再送する。失敗した場合は管理画面のタスク一覧に表示する。
- **優先度**: 管理タスクと通知の優先順位は「コストガード」→「X ID再申請」→「YouTube同期失敗」とする。
- **通知停止**: `user.is_notification_enabled` フラグで制御。
- **コストガード通知**: `economy`, `read_only`, `static_only`, `maintenance` へ遷移した場合は管理者へ Discord DM を送る。管理画面にも同じ内容の通知を残し、DM 失敗時でも管理者が状態を確認できるようにする。

### 2-14-1. 利用規約管理と再同意
- **公開規約**: `/rules` は最新公開済みの `terms_versions` を表示する。
- **管理画面**: `/admin/rules` で管理者が規約の下書き作成、プレビュー、公開、過去バージョン確認を行う。
- **再同意**: 新しい規約を公開した場合、既存ユーザーの `terms_reaccept_required` を1にする。次回の作品投稿、作品編集保存、作品提出時に再同意画面を挟み、同意後に `user_tos_consents` を記録する。
- **スロット確保との関係**: スロット確保だけでは原則ブロックしない。ただし投稿・提出に進む時点で最新規約への同意を必須にする。

### 2-15. X ID連携と既存作品の編集権限
- **三者照合**: セッションのユーザー ID、X ID、および DB の所有権情報を厳密に照合（TECHNICAL_SPEC §2.1 参照）。
- **X ID 却下処理の一貫性**: X ID の却下、未提出枠の解放、提出済み作品の X ID 再申請 case 作成、通知送信予約、`history_logs` 記録は、D1 のトランザクションまたはそれに準じる一括処理として扱う。途中失敗した場合は管理者タスクに出す。
- **X ID 却下後の提出済み作品**: 受付中イベントで提出済み作品の X ID が却下された場合、作品は即時削除せず `video_moderation_cases.case_type = "x_reapply"` の open case を作る。作品の公開可否は `videos.visibility_status` で管理し、通常は `pending` または `hidden` として公開導線から外す。ユーザーには枠の取り直しを先に促し、その後 X ID 再申請または既存承認済み ID への付け替えを行うウィザードへ誘導する。
- **再申請期限**: `video_moderation_cases.case_type = "x_reapply"` の open case は7日以内の対応を求める。期限切れの3日前と24時間前に Discord DM と管理画面通知でリマインドし、最終確認通知は送らない。管理者だけが個別延長でき、最大 +7日、合計14日までにする。期限を過ぎた場合、または枠取り直しをしないままイベント受付が終了した場合は `videos.visibility_status = "voided"` にし、case を expired として閉じる。連続3回却下された場合は再申請を一時ロックし、管理者への問い合わせを促す。
- **枠の取り直し**: 新しい枠が確保されるまで公開処理、上映順確定、旧形式エクスポート出力の対象にしない。元枠は24時間だけ優先再取得候補として提示する。元枠が取れない場合は代替枠があれば提案し、なければ「取得可能な枠がありません」と表示する。連続枠数は短縮・延長を許可し、イベントの最大連続取得数を超えない範囲にする。
- **編集許可**: X ID 再申請 case が open の間でも作品本文、YouTube URL、合作メンバー、クレジット修正を許可する。却下理由は auth 側で本人に表示し、本人向け公開文面は「プロフィール未確認」「ID不一致」「非公開アカウント」「その他」のテンプレートから選び、管理者が文面編集できる。内部メモと本人向け文面は完全に分離し、内部メモを公開 API に載せない。
- **通知**: X ID 再申請が必要になった場合、Discord DM と管理画面通知で知らせる。メール通知は基本的に使わない。通知失敗時は管理画面のタスク一覧に表示する。
- **運営による無効化**: 運営は必要に応じて作品を `videos.visibility_status = "voided"` に変更し、`video_moderation_cases.case_type = "void"` を記録できる。これは「作品ごとなかったことにする」運用であり、公開ページ、一覧、旧形式エクスポート、スコア計算から除外する。完全な物理削除ではなく、監査ログと管理画面で追跡できる論理無効化とする。`voided` 操作は二段階確認を必須にする。
- **再申請後の復帰**: 再申請された X ID が承認され、枠が取り直され、必要項目が揃った場合は自動的に `pending` へ戻す。既存承認済み X ID へ付け替える場合は、作者表示名を付け替え先 X ID の現在の表示名へ自動同期し、アイコン候補にも自動追加する。元の却下済み X ID は公開ページには出さず、管理画面と担当イベントのイベント編集許可者に確認用履歴として表示するが、正規 alias にはしない。
- **X ID統合との競合**: X ID 再申請と X ID 統合が同時に発生した場合は、作品の公開復帰に必要な再申請フローを優先する。統合処理は一時停止し、主体の復帰が完了してから再開する。ウィザード開始時点の再申請対象 ID を優先・固定し、途中でアクティブ X ID を切り替えても勝手に対象を変えない。
- **Discord連携解除時**: X ID 再申請中または未公開の作品は `voided` にし、公開済み作品は所有者不明のアーカイブ扱いとして公開履歴を保持する。X ID の表示名変更履歴は公開ページでは最新名だけ反映し、履歴は管理画面の監査用に留める。

### 2-16. X ID統合（マージ）
- **マージ**: 旧 ID のいいねやポートフォリオを新 ID へ統合。
- **本人保有 ID の統合**: 同一 Discord ユーザーに紐づく複数 X ID は、ユーザー本人がどちらへ統合するかを選択できる。
- **取消**: 統合後の取消は `x_id_merge_reverts` と `history_logs` のスナップショットを利用し、移行したデータを復元する。外部同期済みで完全復元できない項目は UI 上で明示する。
- **取消期限**: 統合完了から180日以内に限り取消申請を受け付ける。通常の履歴ログ保持期間とは別に、統合復元に必要な `restore_snapshot_json` は少なくとも180日保持する。
- **旧 ID 保持**: 統合元 ID は削除せず `x_user_aliases` に保持し、過去クレジットやプロフィールリンクの断絶を防ぐ。

### 2-17. カスタムページ / ショートコード
- **安全な描画**: サニタイズ + サンドボックス iframe (TECHNICAL_SPEC §4.2 参照)。
- **ドメイン分離**: FlameNode のユーザーコンテンツ専用サブドメインでホストする。
- **任意機能**: ポートフォリオページは全員必須ではない。ユーザー本人が有効化した場合のみ公開し、未有効の場合は通常プロフィールと作品一覧だけを表示する。

### 2-18. パーソナライズ推薦
- **嗜好優先**: 視聴時間やブックマークに基づく。
- **score 計算**: `videos.score` を新規表示クエリの優先値にし、`video_stats.score` は worker / 旧DB fallback 用に当面 dual-write で残す。

### 2-19. 動画プレイヤー拡張
- **コマ送り**: 1/30秒調整。
- **独自プレイヤー**: YouTube iframe を FlameNode の独自操作レイヤーで包み、再生、停止、音量、全画面、シーク、コマ送りを提供する。
- **透かし UI 非表示**: マウス停止またはプレイヤー領域外移動時は、再生バーなどのオーバーレイを即座に消す。
- **振り返り上映用データ**: 作品本文に常設せず、動画詳細ページのポップアップで表示する。
- **時間付き情報**: 通常コメント欄は持たず、X ID と `video_chapters` の秒数付きメモとして扱う。メンバー別の担当チャプターは `video_members.chapters_json` に保持する。
- **チャプターマーカー**: `video_chapters.show_on_player_bar = 1` の行を、再生バー上に小さな点として表示する。位置は `chapter_time / duration` で算出し、ホバーまたはキーボードフォーカス時に時刻、ラベル、公開/非公開状態を小さな吹き出しで表示する。
- **マーカー操作**: 点をクリックまたは Enter/Space で選択すると該当秒数へシークする。視覚上の点は小さくして映像を邪魔しないが、操作判定領域は十分に広く取り、キーボードでも移動できるようにする。
- **密集時の扱い**: マーカーが密集する場合は `marker_kind = 'chapter'` を優先し、画面幅に応じて2秒以内のマーカーを1つの点へまとめる。ホバー、タップ、キーボードフォーカス時に複数候補リストを展開する。通常コメント由来の点は縮約表示または表示切替に回し、モバイルではチャプター点を優先して細かなコメント点は一覧側で確認させる。
- **非公開チャプター**: 本人と管理者だけ、非公開チャプターを半透明の点として再生バー上に表示できる。一般閲覧者と担当外ユーザーには表示しない。
- **プレビュー表示**: YouTube iframe から任意時刻の正確なサムネイルを安定取得できない可能性が高いため、初期実装ではフレーム画像プレビューを必須にしない。Cloudflare/R2 にプレビュー画像を生成・保存せず、低コストに取得できる YouTube 由来の手段がある場合のみ任意機能として扱う。未対応時は時刻、ラベル、周辺コメント数、投稿者アイコンを表示するテキストプレビューで代替する。アイコンを出す場合は `marker_kind = 'chapter'` の作成者アイコンを優先する。
- **モバイル操作**: モバイルでもコマ送り操作を必須とし、審査や細かな確認に使えるようにする。

### 2-20. 編集可能フィールド制御
- **制御**: イベントごとの `editable_fields` 設定を優先。
- **設定権限**: 編集可能フィールド設定を変更できるのは、管理者または当該イベントの編集許可者のみ。通常ユーザーは許可済みフィールドの範囲内で作品を編集する。
- **協力者の個別制御**: `event_staff.permission_mask` により、イベント単位かつ編集権限単位で操作可否を設定する。協力者の許可範囲は、対象イベントと権限キーに一致する範囲を超えられない。

### 2-21. 管理者・イベント編集許可者 (RBAC)
- **管理者**: 全作品の編集権限、X ID 承認、ユーザー管理、BAN、イベント承認、イベント編集許可者の承認、全イベント設定、監査ログ確認を含むすべての管理操作ができる。
- **イベント編集許可者**: 管理者が承認したユーザーのみが担当イベントを開催・編集できる。担当イベントに限り、以下の項目を編集できる。
  - 開催スケジュール（開始・終了日時）
  - スロット形式（時間ベース/数量ベース）の切り替えと一括生成
  - 企画説明（メタデータ）の編集
  - 動画収集情報（`custom_questions`, `editable_fields`）の編集
  - そのイベントに紐づく作品の編集権限設定
  - そのイベントに紐づく作品内容そのものの編集
  - イベント運営メンバー設定
- **協力者**: イベント単位で付与される補助編集者。管理者または当該イベントのイベント編集許可者が追加し、協力者ごと・編集権限キーごとに許可を設定する。本人承認は不要で、追加された時点で有効になる。権限のない項目は UI 上で非活性にし、保存時にも拒否する。
- **公開表示**: 公式イベントと第三者イベントは公開ページ上で同じ見え方にする。イベント代表者と運営メンバーは、公開対象に設定されたメンバーのみ表示し、管理画面だけで見えるメンバーは公開ページへ出さない。
- **監査**: イベント編集許可者による変更は全て `history_logs` に記録される。
- **第三者イベント開催**: 第三者主催イベントは、管理者がイベント編集許可者を承認した場合に開催できる。公開ページ上では外部主催・コミュニティ主催などのラベルは付けず、代表者と運営メンバー情報で運営主体を確認できるようにする。

### 2-22. コメント/チャプターの非配列化
- **正規化**: テーブルを分離して管理。FK (ON DELETE CASCADE) で整合性保証。
- **表示方針**: 動画詳細ではコメント欄感を強く出さず、時間付きチャプター一覧を中心に見せる。公開チャプターは他ユーザーも閲覧でき、非公開チャプターは本人と管理者だけが見られる。

### 2-23. 作品編集権限の制御 (Editable Fields Hierarchy)
作品のステータスや所属イベントに応じて、ユーザーが編集可能な項目を動的に制御する。

#### 制御ロジックの優先順位
1. **イベント別設定 (Event Override)**: `events.editable_fields` (JSON) が定義されている場合、その設定を最優先する。
2. **イベント協力者設定 (Collaborator Override)**: 協力者として編集する場合、対象作品が属するイベントの `event_staff.permission_mask` を適用する。ただしイベント別設定で禁止された項目は協力者側で許可されていても編集不可にする。
3. **全体デフォルト設定 (Global Default)**: イベント別設定がない、または所属イベントがない過去作品（Legacy）の場合、`system_settings.default_editable_fields` を適用する。
4. **新規/枠あり作品の特例**: 
   - 予約枠 (`slots`) に紐づく未公開作品、または `status` が `draft`/`pending` の作品は、管理者が明示的に制限しない限り**全項目編集可能**をデフォルトとする。
   - ただし、この挙動も `system_settings.upcoming_editable_fields` で一括制御可能とする。

#### 編集制限の対象項目例
- タイトル、楽曲名、クレジット、紹介文、使用ソフト、YouTube ID、アイコン、参加メンバー等。
- 管理者は UI 上でチェックボックス形式により、項目ごとの「編集許可/禁止」を切り替える。
- 協力者設定では、イベント内で権限キー単位のチェックボックスを個人ごとに持つ。例として「イベント説明のみ」「スロットのみ」「楽曲・クレジットのみ」「振り返り上映用データのみ」「メンバー表だけ」のように分ける。

#### イベント協力者の権限キー
| permission_key | 対象 | 許可される操作 |
| :--- | :--- | :--- |
| `event.basic` | イベント基本情報 | タイトル、説明、画像、開催期間、受付状態の編集 |
| `event.slots` | イベント枠 | スロット作成、編集、公開、確保状況の調整 |
| `event.members` | 運営メンバー | 公開/非公開運営メンバー、役職ラベル、代表者候補の編集 |
| `event.questions` | 入力項目 | `custom_questions`, `review_settings`, `editable_fields` の編集 |
| `videos.title` | イベント内作品 | 作品タイトル、表示名、読み方の編集 |
| `videos.music_credit` | イベント内作品 | 楽曲名、クレジット、楽曲URLの編集 |
| `videos.members` | イベント内作品 | 合作メンバー、役職、コメント、並び順の編集 |
| `videos.review_data` | イベント内作品 | 振り返り上映用データ、制作コメント、使用ソフト、カスタム回答の編集 |
| `videos.youtube_id` | イベント内作品 | YouTube URL / ID の登録・差し替え |
| `videos.primary_event` | イベント内作品 | `primary_event_id` の変更。ただし担当外イベントへの変更は管理者確認を必要とする |
| `collaborators.manage` | イベント協力者 | イベント協力者には付与しない。協力者管理はイベント編集許可者以上に限定 |

### 2-23-1. CSV インポート共通仕様
各種入力欄のうち、複数行・複数人・複数枠を扱う項目は CSV 形式での貼り付けまたはファイル投入を受け付ける。

- **対象**: 合作メンバー、イベント協力者権限、イベント運営メンバー、スロット一括生成、カスタム質問、使用編集ソフト辞書、過去作品、過去イベント。
- **UI**: 通常入力と CSV 入力をタブで切り替える。CSV 入力欄の横に「CSV作成プロンプトをコピー」ボタンを置く。
- **プロンプト内容**: 対象入力欄の列名、必須/任意、値の例、禁止事項、出力形式を含める。ユーザーが外部 AI や表計算ソフトに貼って CSV を作れる内容にする。
- **プレビュー**: 保存前に列マッピング、重複、ID候補、文字コード、行数、エラーを一覧で表示し、問題行だけ修正できるようにする。
- **保存方針**: 既存データへの反映は「追記」を既定かつ基本動作にする。既存行と同じ X ID や同じ名前がある場合も自動更新はしない。重複候補はプレビューで警告し、「取り込まない」または「警告しつつ追記」を選択できるようにする。
- **列名ゆれ**: `お名前`, `名前`, `name`, `タイトル`, `title` など、一般的な列名エイリアスは辞書と正規表現で自動判定する。自信が低い列はプレビューで手動確認させる。
- **時間なしスロット**: 旧データや CSV で日時がない枠は、時間なしスロットとして連番で取り込む。
- **監査**: CSV からの一括変更は、件数、対象テーブル、変更前後の要約、入力ファイル名または貼り付け元メモを `history_logs` に残す。

#### フィールドマッピング定義
| 旧フィールド | 新フィールド (videos) | 変換ロジック |
| :--- | :--- | :--- |
| `title` | `title` | |
| `creator` | `display_name` | |
| `yomi` | `display_name_yomi` | |
| `tlink` | `contact_x_id` | `@` を除去 |
| `icon` | `icon_url` | `drive.google.com/open?id={id}` → `lh3.googleusercontent.com/d/{id}` |
| `time` | `scheduled_time` | ISO / UNIX タイムスタンプ変換 |
| `timestamp` | `created_at` | UNIX タイムスタンプ変換 |
| `ylink` | `youtube_video_id` | URL から 11 桁の ID を抽出 |
| `music` / `credit` | `music` / `credit` | |
| `comment` | `intro_comment` | |
| `beforecomment` | `intro_comment` | `comment` が空なら使用、または結合 |
| `aftercomment` | `closing_comment` | 振り返りコメントとして保存 |
| `soft` | `used_software_json` | 旧 soft 列を JSON 配列に正規化して保存 |
| `movieyear` | `declared_experience` | 制作歴・参加区分として保存 |
| `type1` | `collaboration_type` | `"個人"` → `"solo"`, `"複数人"` → `"collab"` |
| `toudan` | `custom_answers` | `{"toudan": "..."}` として JSON 保存 |
| `hitokoto` | `highlights` | |

#### メンバー情報の 1:1 対応
- `member` (名前) と `memberid` (X ID) をカンマで `split` し、インデックス番号で紐付けて `video_members` に登録する。

### 2-24. 動画個別ページ（/[id]）
- **構成**: 旧ページの動画詳細デザインに寄せ、プレイヤー、作品タイトル、投稿者情報、チャプター一覧、スタッフセクション、制作エピソード、関連動画を高密度に配置する。
- **ウルトラワイド配置**: 横幅が十分に広い場合は、左に作品タイトル・投稿者情報・チャプター一覧、中央に動画プレイヤー、右に関連動画と再生リストを置く3カラム独自レイアウトにする。
- **関連動画**: 同一作者、合作メンバー、同一楽曲、同一クレジット、所属イベント内の前後作品、`videos.score`、ランダム補完を候補化し、重複排除して表示する。最新作品の固定補完は行わない。
- **チャプター**: ユーザーは任意の秒数を手動設定でき、自分のチャプター一覧、公開/非公開切替、他ユーザーの公開チャプター閲覧に対応する。
- **再生バー上の点表示**: 公開チャプター、投稿者または管理者が指定した重要チャプター、自分の非公開チャプターを再生バー上に点として表示できる。点の色はイベントアクセントまたは FlameNode の黄色を基本にし、非公開点は控えめな色で区別する。
- **コメント**: 通常コメント用 `video_comments` は使わない。時刻付きの反応・メモは `video_chapters`、メンバー担当チャプターは `video_members.chapters_json` に保存し、投稿主体は常に `user.active_x_user_id` とする。
- **再生リスト**: 右レールの一部に YouTube の再生リストに近い UI を設け、イベント内上映順、自分のいいね作品、自分のブックマーク/セーブ作品を順番再生できる。
- **チャプター/コメント表示**: 左カラムの時系列情報は「チャプター」「コメント」のタブで切り替え、コメント欄感を強く出さず、時間軸に紐づく反応として見せる。ニコニコ動画風の流しコメントは将来的なクライアントサイド任意機能とし、既定は OFF にする。
- **関連動画と再生リスト**: 右レール最上部に再生リスト風 UI を置き、その下に「同じ作者」「同じイベント」「おすすめ」などの見出し付きセクションで関連動画を出す。

### 2-24-1. デザイン統合
- **参照設計**: `FlameNode-Design-System.md` を全ページ共通のデザイン統合設計図とする。
- **アクセントカラー**: 鮮やかな黄色を主アクセントとし、主要 CTA、選択中状態、フォーカスリング、アクティブ X ID、イベント開催中表示に使用する。
- **イベント別アクセント**: `events.accent_color` が設定されている場合、イベント詳細、イベント所属作品、イベント参加導線では黄色よりイベントアクセントカラーを優先する。
- **イベントアクセント入力**: イベントアクセントカラーは HEX 入力を許可する。ただしライト/ダーク背景や白黒文字とのコントラストが不足する場合、背景と同化する場合、警告を出して保存前に再確認させる。
- **複数イベント所属作品**: 作品が複数イベントに属する場合、`videos.primary_event_id` のイベントアクセントを優先する。`primary_event_id` は管理者、担当イベントのイベント編集許可者、または作品所有者が権限範囲内で編集できる。
- **テーマ**: ライトモード、ダークモード、システム追従を実装対象とする。トップページと動画詳細は、旧ページの配色そのものではなく配置密度と情報構造を参考にし、色はライト/ダークのテーマトークンに従う。動画詳細のライトモードは白基調を保ち、プレイヤーコントロールだけ高コントラストにする。
- **表示密度**: 公開ページと動画詳細は旧ページの密度を参考にし、大きな枠や過剰な余白で表示数を減らさない。カードやセクションの囲みは必要最小限にする。
- **旧資料不要**: 旧ページの実物、スクリーンショット、HTML、CSS がなくても実装できるよう、トップページ、動画詳細、公開ヘッダー、作品一覧、クリエイター一覧の具体寸法と配置は各 `設計app/(public)/**.md` に記載した内容を正とする。
- **トップページ**: トップ最上部を大きな文字だけで占有する大見出し領域にしない。コンパクトな開催中イベント、注目作品、おすすめ導線から始め、すぐに作品一覧が見える構成にする。
- **全ページ共通**: 公開、認証、管理の全ページにヘッダーとフッターを置く。管理画面のフッターは作業密度を邪魔しない簡易表示にする。
- **絵文字禁止**: UI のナビゲーション、ボタン、状態表示、警告、SNS 導線、プレイヤー操作、管理画面の操作種別には絵文字を使わない。アイコンは Font Awesome を第一候補とし、既存実装に応じて Lucide、Material Symbols、Iconify などの正規 SVG アイコンライブラリを使う。X、YouTube、Discord などのブランド導線は、ライセンス確認済みのブランドアイコンまたは公式ガイドラインに沿った SVG を使う。

### 2-25. 推薦スコアリングと閲覧数計測
作品の「おすすめ度」を定量化し、`/recommend` や関連動画に反映する。

#### スコア算出アルゴリズム (`videos.score`)
- **基本式**: `videos.score = (app_like_count * 10) + app_view_count + normalized_youtube_view_score + recent_boost`
- **重み付け**: 
  - いいね数 (`like_count`) は意図的な評価であるため、閲覧数に対して 10倍の重みを与える。
  - 閲覧数 (`view_count`) は **FlameNode アプリ内での再生開始回数**を主指標にする。
  - YouTube 側再生数 (`youtube_view_count`) もスコアへ含める。ただし巨大な外部再生数だけで FlameNode 内のおすすめが支配されないよう、`log10(youtube_view_count + 1)` を基本に対数化し、アプリ内閲覧数より低い係数で `normalized_youtube_view_score` として加える。
  - 急上昇作品は直近24時間のアプリ内閲覧数を `recent_boost` として扱う。
- **更新タイミング**:
  - `workers/video-score` (Cron Trigger) により 6時間ごとに全作品のスコアを再計算。
  - `like_count` 同期時、またはアプリ内でのインタラクション時に非同期で再計算。

#### アプリ内閲覧数計測 (Internal View Tracking)
- **トリガー**: 動画詳細ページでのプレイヤー再生開始時。
- **制御**: 1セッションは6時間とし、同一セッション内での重複カウントを防止する。ブラウザ側の再生済みキャッシュ、短期 Cookie、IP/UA の短期ハッシュを併用するが、ログイン状態は重複判定には使わない。
- **カウント対象**: 連続再生リストで複数動画を見た場合は、各動画の再生開始を個別にカウントする。自分の作品の再生、管理者やイベント編集許可者の確認再生も除外しない。
- **bot抑制**: IP と UA の短期ハッシュでレートリミットし、1分間に同じ動画へ複数回の再生開始がある場合は無視する。ログイン状態は重複判定には使わない。
- **エンドポイント**: `POST /api/videos/[id]/view` は D1 の `view_count` を直接インクリメントしない。Edge 側の閲覧数集約レイヤーへ送るだけにする。
- **集約方式**: 閲覧イベントは Durable Object を正の短期集約先として動画ID単位でプールし、内部で日付別・時間帯別バケットを持つ。1時間ごとの Cron Worker が差分をまとめて D1 の `videos.view_count` へバルク反映する。KV 時間帯バケットは主経路にせず、緊急時のフォールバックに留める。どの方式でも1再生1書き込みは禁止する。Durable Object 側の未反映カウントは24時間保持し、24時間を超えて反映できない場合は代表管理者へ通知し、監査ログに残して手動確認へ回す。
- **無料枠保護**: `economy` 以上では閲覧数計測のサンプリング率を既定50%に下げ、表示値は `×2` の補正値として見せる。DO危険水位では即停止せず10%サンプリングへ下げる。`read_only` 以上では新規閲覧イベントの書き込みを止め、止めた閲覧数イベントは後から補完しない。機能制限中はサイト上部またはプレイヤー上部に簡易アラートを出す。
- **再生リスト由来**: 連続再生リスト由来の閲覧は個別動画ごとに記録するが、スコア計算上の重みは通常再生の0.5倍にし、自動巡回によるスコアインフレを抑える。
- **ランキング除外**: `videos.visibility_status` が `public` ではない作品、X ID 再申請 case が open の作品、`voided` の作品はランキング・急上昇・おすすめから完全除外する。急上昇作品はトップや一覧のタブで明示的に出す。
- **関連動画比率**: 関連動画ロジックは `videos.score` 40%、同一作者・同一イベント・同一楽曲・同一クレジットなどの文脈近さ60%を目安にし、単なる人気順より関連性を優先する。

### 2-26. 上部メニューバーのアクティブ X ID 常駐
- **表示**: ログイン済みユーザーには全エリアの上部メニューバーに現在のアクティブ X ID を表示する。
- **切替**: 複数 X ID を保有する場合、Twitter 風の一覧ポップオーバーを開いて選ぶ。表示順は「承認済み」→「再申請中」→「承認待ち」で固定し、Discord名、Xでの表示名、アイコンを表示する。
- **参照**: いいね、ブックマーク、投稿、編集、コメント、チャプターは `user.active_x_user_id` を既定主体として使用する。
- **設定画面との関係**: `/dashboard/settings` は詳細な連携・統合・取消管理を担い、グローバルメニューは日常的な切替に特化する。

### 2-27. Discord 認証・セキュリティ設計
- **OAuth2**: state + PKCE。
- **Guild 検証**: ログイン時に FlameNode サーバー参加をチェック（7日間キャッシュ）。
- **トークン管理**: Guild チェック完了後、`account.access_token` は `updateUser` コールバック内で削除する。リフレッシュトークンのみ保存（再認証時に必要最小限）。
  - **理由**: Discord API の一部エンドリフレッシュトークンのみ必要。アクセストークンは認証リクエスト毎に再取得可能。
  - **実装**: `events.linkAccount` コールバック内で `account.access_token = null` を設定し、DB から実質削除。
- **データアクセス**: D1 直接アクセス禁止。Server Actions で認可チェック（三者照合：Session, Ownership, X-Link）。
- **セキュリティ 4 層防御**: TECHNICAL_SPEC §4 参照。

### 2-28. Cloudflare 無料枠・コストガード
- **静的ファースト**: トップ、一覧、イベント詳細、関連動画、おすすめは R2 に事前生成した JSON と Pages Static Assets を優先し、Pages Functions / Workers / D1 の呼び出しを抑える。
- **D1節約**: 一覧系はフルスキャン禁止。必ずインデックス、ページング、事前集計を使う。`videos.score` や関連動画は Cron でまとめて生成する。
- **R2節約**: 動画本体は保存せず YouTube 埋め込みを使う。R2 はアイコン画像、静的 JSON、旧形式エクスポートに限定する。`ListObjects` は高コスト操作として一覧表示に使わない。
- **画像保存**: 作品サムネイルは Cloudflare/R2 に保存せず、YouTube サムネイル URL を使う。Cloudflare にアップロードする画像はユーザー/作品に紐づくアイコン画像のみとし、元ファイルは1ファイル8MBまでにする。
- **KV節約**: KV は Worker cursor、軽量フラグ、短期キャッシュに限定する。高頻度ログや閲覧数を逐次書き込まない。
- **Durable Object節約**: 閲覧数集約には Durable Object を使うが、1再生ごとに Worker/DO request は消費するため、`economy` では50%サンプリング、`read_only` では新規計測停止にする。
- **Queues節約**: YouTube同期やDiscord通知キューは1メッセージあたり複数 operation を消費するため、クォータ不足時は優先度を付け、不要な一括投入を避ける。
- **手動制限**: 使用量collectorや自動しきい値判定は持たない。運用者が Cloudflare Dashboard を確認し、必要に応じて `operation_mode` を `normal` / `economy` / `read_only` / `static_only` へ手動変更する。
- **停止順序**: 最初に検索のフルスキャン系を停止し、次に動的推薦・リアルタイムスコア再計算を落とす。Discord通知キューは運営対応に直結するため優先し、YouTube同期キューは一時停止対象にする。
- **管理者操作**: 管理者は `/admin/cost-guard` で現在モード、停止機能、変更理由、直近の監査ログ、一時例外期限を確認し、モード変更と一時許可を操作できる。`maintenance` への移行・解除は通常モード変更とは別の専用操作にする。
- **一時許可**: `read_only` 中の管理者一時許可は、許可リストにある機能を1〜8件指定し、確認文字列と理由を要求したうえで設定時刻から厳密に15分だけ有効にする。設定・解除は監査ログに残す。
- **停止対象**: `read_only` 以上では新規投稿、作品編集、コメント、チャプター/チャプターマーカー作成、いいね、ブックマーク、アイコン画像アップロード、CSV インポート、旧形式エクスポート再生成、スロット一括生成を停止する。
- **記録**: コストガードとメンテナンスの変更は完全な before / after と理由を監査ログへ記録する。自動遷移や自動通知は行わない。
- **静的JSON生成**: トップ、一覧、イベント詳細、関連動画、おすすめの静的 JSON は通常1時間ごと、イベント開催中は5〜10分ごとを目安に生成する。
- **閲覧継続**: 可能な限り公開閲覧は静的ページと静的 JSON で継続し、書き込み・重い動的処理から先に止める。
- **静的配信退避**: R2 Class B が増えすぎる場合、静的 JSON は Pages Static Assets へ寄せる。`static_only` 中もログインページとセッション検証は最小限残し、`maintenance` 中は事前生成済み静的 HTML/JSON の閲覧だけを可能にする。
- **画像とJSONの整理**: アイコン画像は新規アップロード時に8MB上限を適用し、古いアイコンは月次ワーカーで最大200KB程度の WebP へ圧縮・上書きする。静的 JSON は直近3世代のみ保持し、古いオブジェクトは自動削除する。
- **有料化判断**: 月間のD1読み書き、または Pages Functions 要求が無料枠の80%を常に超える状態が2か月続いた場合、有料化または構成見直しの判断ラインにする。
- **参照設計**: 詳細なモード別制限とルート別軽量化は `FlameNode-Cloudflare-Free-Tier-Guardrails.md` に従う。

---

## 3. Next.js / Cloudflare 統合ディレクトリ構成案

本プロジェクトは Next.js (App Router) をフロントエンドとし、Cloudflare D1 (Database), R2 (Storage), KV (Cache), Workers (Cron/Triggers) をバックエンド基盤として統合した構成をとる。

```text
/
├── .dev.vars                  # ローカル開発用環境変数 (Wrangler 用)
├── drizzle.config.ts          # D1 移行管理 (Drizzle Migrations)
├── package.json
├── tsconfig.json
├── wrangler.toml              # Cloudflare Pages / D1 / R2 / KV 設定
├── public/                    # 静的アセット (ロゴ, 共通アイコン等)
│
├── app/                       # Next.js App Router
│   ├── (public)/              # 【公開エリア】ログイン不要
│   │   ├── layout             # 公開エリア共通レイアウト
│   │   ├── page               # TOPページ (おすすめ・最新・イベント一覧)
│   │   ├── list/              # 全作品一覧 (フィルタ・ソート機能付)
│   │   ├── event/[id]/        # 特定イベントの参加作品一覧
│   │   ├── user/[id]/         # クリエイタープロフィール
│   │   │   └── portfolio/     # カスタムポートフォリオ (サンドボックス表示)
│   │   ├── recommend/         # パーソナライズ推薦ページ
│   │   ├── rules/             # 利用規約・ガイドライン
│   │   ├── search/            # グローバル検索結果
│   │   └── [id]/              # 作品詳細ページ (UUID / YouTubeID 両対応)
│   │
│   ├── (auth)/                # 【ユーザーエリア】要 Discord ログイン
│   │   ├── layout             # セッション・ギルド参加チェック
│   │   ├── entry/             # 新規イベントエントリー / スロット予約
│   │   └── dashboard/         # マイページ
│   │       ├── page           # 参加作品一覧・通知サマリー
│   │       ├── settings/      # プロフィール設定・X ID 連携管理
│   │       └── post/          # 作品情報更新
│   │           ├── slotted/   # 枠あり作品投稿・編集
│   │           ├── unslotted/ # アーカイブ作品登録
│   │           └── [id]/      # 既存作品の編集
│   │
│   ├── (admin)/               # 【運営エリア】管理者・イベント編集許可者
│   │   ├── layout             # 管理者 / イベント編集許可者 権限チェック
│   │   └── admin/
│   │       ├── page           # 管理ダッシュボード
│   │       ├── videos/        # 動画審査・一括ステータス変更
│   │       ├── events/        # イベント作成・スロット生成・質問編集
│   │       ├── users/         # ユーザー管理・BAN・X ID 連携承認
│   │       ├── history/       # 監査ログ閲覧・データ復元操作
│   │       ├── merges/        # X ID 統合リクエスト管理
│   │       ├── rules/         # 利用規約の編集・公開管理
│   │       └── import/        # レガシーデータ・インポート
│   │
│   └── api/                   # Route Handlers
│       ├── auth/              # Auth.js (NextAuth) エンドポイント
│       ├── upload/            # R2 アップロード (署名付きURL発行)
│       ├── legacy/            # 旧システム (OBS等) 互換用 API
│       │   ├── event/[id]/
│       │   └── videos/
│       └── webhooks/          # 外部連携 Webhook (Discord 等)
│
├── src/
│   ├── components/            # React Components
│   │   ├── ui/                # 基本パーツ (Shadcn/ui 等の Atomic Components)
│   │   ├── video/             # 動画関連 (VideoCard, Player, YouTubeInput, Chapters)
│   │   ├── user/              # ユーザー関連 (Avatar, XIdSwitcher, MemberInput, IconPicker)
│   │   ├── layout/            # レイアウト関連 (Header, Sidebar, FilterBar, SectionHeader)
│   │   └── shared/            # 共通 (Skeleton, SlotStatusCard, CustomRenderer)
│   │
│   ├── actions/               # Server Actions (D1 書き込みロジック)
│   │   ├── video.ts           # 作品投稿・更新・削除
│   │   ├── slot.ts            # スロット予約・解放 (CAS パターン)
│   │   ├── user.ts            # X ID 連携・プロフィール更新
│   │   └── admin.ts           # 審査・イベント操作・ログ操作
│   │
│   ├── lib/                   # ユーティリティ・外部連携
│   │   ├── db/
│   │   │   ├── client.ts      # D1 (Drizzle) クライアント接続
│   │   │   ├── schema.ts      # D1 テーブル定義 (Single Source of Truth)
│   │   │   └── queries.ts     # 共通クエリヘルパー
│   │   ├── auth/              # Auth.js 設定・権限チェック (三者照合)
│   │   ├── storage/           # R2 (S3 互換) クライアント・署名付きURL発行
│   │   ├── youtube/           # YouTube API 連携・正規化・同期ロジック
│   │   ├── discord/           # Discord Bot 通知・ギルド検証ロジック
│   │   ├── security/          # Webhook 署名検証 (Ed25519)
│   │   └── utils/             # 共通ヘルパー (日付変換、バリデーション等)
│   │
│   ├── hooks/                 # カスタムフック (SWR, ポーリング, UI状態管理)
│   ├── types/                 # TypeScript 型定義
│   └── styles/                # グローバル CSS / デザインシステム変数
│
├── workers/                   # 独立した Cloudflare Workers (バックグラウンド処理)
│   ├── json-generator/        # R2 + KV への members.json / eventinfo.json 定期出力 (毎時)
│   ├── cleanup/               # 保持期間を過ぎた履歴ログの自動削除 (毎日)
│   ├── youtube-sync/          # メタデータ・いいね・チャプターマーカー候補の定期同期 (6時間ごと)
│   ├── notification-sender/   # 通知キューの DM 送信 (5分ごと)
│   ├── r2-gc/                 # 孤立アップロードファイルの削除 (毎日)
│   └── video-score/           # videos.score / video_stats.score 再計算 (6時間ごと)
│
└── migrations/                # D1 (Drizzle) のマイグレーションファイル群
```

**特記事項:**
- 全てのデータベース操作は `src/lib/db/schema.ts` を正として管理し、`drizzle-orm` を通じて型安全に実行する。
- Cloudflare Pages の制限を考慮し、大規模な計算や定期ジョブは Next.js 内部ではなく、独立した `workers/` 以下のスクリプトを Cron Triggers で運用する。
- 検索機能は D1 が FTS5 をサポートしないため、`LIKE '%query%'` または KV インデックスで実装する。
