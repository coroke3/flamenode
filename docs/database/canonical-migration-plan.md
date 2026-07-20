# FlameNode DB正本・旧形式移行仕様

> Status: Active  
> Last verified: 2026-07-20  
> Verified against commit: `d12eabf`  
> Source of truth: `src/lib/db/schema.ts`, `src/lib/db/schema.canonical.ts`, `migrations/0043_db_canonical_migration.sql`
> Canonical schema version: `2026-07-20-canonical-1`

## 1. 文書の役割

この文書は、FlameNodeのDB正本移行における**仕様判断の正本**である。型、SQL、API、管理画面、CSV、外部出力、監査復元、テストは、すべて本書とDrizzle正本へ揃える。

本書は「実装済み」を示す証拠ではない。完了判定には、移行SQL、ランタイム参照、検証スクリプト、CI結果を別途確認する。

### 優先順位

矛盾がある場合は、次の順で判断する。

1. 本書の「禁止事項」「不変条件」「状態モデル」
2. `src/lib/db/schema.canonical.ts` のテーブル・制約定義
3. `migrations/0043_db_canonical_migration.sql` の移行処理
4. 現行ランタイムコード
5. 過去のmigration・設計資料

## 2. 確定値

| 項目 | 値 |
| --- | ---: |
| 正本テーブル | 41 |
| 正本カラム | 409 |
| 廃止・統合テーブル | 8 |
| 削除対象旧カラム | 25 |
| 名称変更 | 2 |

## 3. 禁止事項

- 旧テーブル・旧カラムを、バックフィルと切替完了前に削除しない。
- `events.max_slots_per_video` を削除・別用途化しない。
- 最後のイベントownerを削除、降格、無効化しない。
- YouTube動画IDを複数テーブルへ二重書きしない。
- `video_members.chapters_json` を検証なしで破棄しない。
- `videos.visibility_status='archived'` を一律変換しない。
- 一般ランタイムへ旧DB構造の互換分岐を残さない。
- 未確定の削除、統合、名称変更を本migrationへ混ぜない。

## 4. 状態モデル

### 4.1 イベント

DBへ保存する公開状態は次の2値だけとする。

| 保存値 | 意味 |
| --- | --- |
| `private` | 一般公開しない |
| `public` | 一般公開する |

`draft`、`archived` は保存しない。開催段階と募集段階は日時から算出し、DBへ重複保存しない。

#### 開催段階

| 条件 | 算出値 |
| --- | --- |
| 現在時刻 `< start_time` | 開始前 |
| `start_time <=` 現在時刻 `< end_time` | 開催中 |
| `end_time <=` 現在時刻 | 終了済み |

日時が欠ける場合は、公開API・管理画面で「日時未設定」として明示し、推測値を保存しない。

#### 募集段階

| 条件 | 算出値 |
| --- | --- |
| 現在時刻 `< entry_start_time` | 募集前 |
| `entry_start_time <=` 現在時刻 `< entry_end_time` | 募集中 |
| `entry_end_time <=` 現在時刻 | 募集終了 |

#### 旧値の移行

| 旧値 | 新値 |
| --- | --- |
| `draft` | `private` |
| `private` | `private` |
| `public` | `public` |
| `archived` | `public` |

### 4.2 作品

- `draft` は原則 `private` へ移行する。
- `archived` は件数・理由・参照状況を先に出力し、各行を `private` または `voided` へ分類する。
- 分類不能な `archived` が1件でも残る場合、破壊的migrationを失敗させる。
- YouTube上の限定公開は公開可否とは分離し、YouTubeプライバシー情報として扱う。

## 5. 横断的不変条件

| 領域 | 正本 | 廃止する重複表現 |
| --- | --- | --- |
| X名義と認証ユーザー | `x_user_account_links` | `x_users.linked_user_id`、`event_staff.user_id`、`video_members.user_id` |
| X ID申請 | `x_identity_requests` | 旧申請3テーブル |
| イベントowner | `event_staff.permission_preset='owner'` | `events.representative_x_user_id` |
| スタッフ権限 | `permission_preset` | `event_staff.role` |
| 公開肩書 | `public_role_label` | 権限列との兼用 |
| イベントグループ表示順 | `events.start_time DESC, events.created_at DESC` | `event_group_events.sort_order` |
| 枠上限 | `events.max_slots_per_video` | `max_consecutive_slots_per_entry` |
| 公開API更新判定 | `events.updated_at` と `audit_logs` | `events.public_api_updated_at` |
| チャプター | `video_chapters`、`chapter_time ASC` | `chapters_json`、`show_on_player_bar`、`order_index` |
| 使用ソフト表示順 | `software_catalog.name ASC, raw_label ASC` | `video_softwares.order_index` |
| YouTube動画ID | `videos.youtube_video_id` | `video_youtube_metadata.youtube_video_id` |
| いいね・保存 | `(x_user_id, video_id, interaction_type)` | 独立ID、外部同期列 |
| 監査設定 | `system_settings.audit_*` | `audit_log_settings`、`history_retention_days` |
| 旧形式インポート | 入力アダプター → canonical plan → 新正本 | 旧DB構造への書戻し |

## 6. 正本テーブル一覧

正確なカラム型、NULL制約、外部キー、CHECK、indexは `src/lib/db/schema.canonical.ts` を参照する。

| 領域 | テーブル | カラム | 役割 |
| --- | --- | ---: | --- |
| X | `x_identity_requests` | 12 | X ID申請の統合正本 |
| X | `x_user_account_links` | 6 | X名義と認証ユーザーの多対多リンク |
| X | `x_user_aliases` | 2 | X ID別名 |
| X | `x_users` | 9 | クリエイター名義 |
| イベント | `event_group_events` | 5 | イベントとグループの所属 |
| イベント | `event_groups` | 12 | イベントグループ |
| イベント | `event_staff` | 12 | owner、運営権限、公開肩書 |
| イベント | `event_templates` | 8 | イベント設定雛形 |
| イベント | `events` | 27 | イベント本体 |
| イベント | `slots` | 13 | 投稿枠 |
| システム | `flamenode_schema_meta` | 3 | 適用スキーマ版 |
| システム | `system_settings` | 17 | 全体設定・監査設定 |
| ソフト | `software_aliases` | 3 | ソフト別名 |
| ソフト | `software_catalog` | 9 | ソフト辞書 |
| 作品 | `video_chapters` | 9 | チャプター |
| 作品 | `video_events` | 2 | 作品のイベント所属 |
| 作品 | `video_interactions` | 4 | いいね・保存 |
| 作品 | `video_members` | 12 | 作品メンバー・編集権限 |
| 作品 | `video_moderation_cases` | 14 | 作品対応案件 |
| 作品 | `video_softwares` | 3 | 使用ソフト |
| 作品 | `video_youtube_metadata` | 9 | YouTube変動情報 |
| 作品 | `videos` | 28 | 作品本体 |
| 外部連携 | `event_youtube_playlist_items` | 6 | 再生リスト項目索引 |
| 外部連携 | `event_youtube_playlist_sync` | 14 | 再生リスト同期設定 |
| 外部連携 | `external_api_quota_usage` | 5 | 外部API使用量 |
| 投稿フォーム | `event_custom_questions` | 15 | イベント追加質問 |
| 投稿フォーム | `video_custom_answers` | 7 | 作品別回答 |
| 監査 | `audit_logs` | 20 | before/after監査正本 |
| 監査 | `audit_restore_runs` | 7 | 復元実行履歴 |
| インポート | `spreadsheet_import_runs` | 9 | 一度限りの取込preview |
| 規約 | `terms_versions` | 9 | 利用規約版 |
| 規約 | `user_tos_consents` | 5 | 規約同意証跡 |
| 認証 | `account` | 11 | Auth.js外部認証 |
| 認証 | `session` | 3 | ログインセッション |
| 認証 | `user` | 17 | 認証ユーザー |
| 認証 | `verificationToken` | 3 | 確認トークン |
| 通知 | `announcements` | 11 | サイト内お知らせ |
| 通知 | `notification_outbox` | 15 | 再試行可能な通知配送 |
| Worker | `static_artifacts` | 9 | R2静的JSON成果物 |
| Worker | `static_rebuild_queue` | 16 | 静的JSON再生成キュー |
| Worker | `worker_leases` | 8 | Worker重複実行防止 |

**合計: 41テーブル / 409カラム**

## 7. 廃止・統合テーブル

| 旧テーブル | 移行先・代替 |
| --- | --- |
| `x_account_link_requests` | `x_identity_requests` |
| `x_id_merge_requests` | `x_identity_requests` |
| `x_id_merge_reverts` | `x_identity_requests` |
| `x_user_icons` | `x_users.icon_url`、`videos.creator_icon_url` |
| `x_user_youtube_channels` | `x_users.youtube_channel_url`、`videos.creator_youtube_channel_url` |
| `legacy_import_batch_items` | R2保管資料・移行レポート |
| `legacy_import_batches` | R2保管資料・移行レポート |
| `audit_log_settings` | `system_settings.audit_*` |

## 8. 削除・名称変更

### 新構造への移行後に削除

`x_users.linked_user_id`、`x_users.verification_token`、`x_users.token_expires_at`、`x_users.approval_requested_at`、`event_group_events.sort_order`、`event_staff.user_id`、`event_staff.role`、`event_staff.internal_note`、`events.representative_x_user_id`、`events.max_consecutive_slots_per_entry`、`events.public_api_updated_at`、`slots.slot_kind`、`slots.priority_reclaim_video_id`、`slots.priority_reclaim_until`、`system_settings.history_retention_days`、`software_aliases.id`、`video_chapters.show_on_player_bar`、`video_chapters.order_index`、`video_interactions.id`、`video_interactions.source`、`video_interactions.synced_at`、`video_members.user_id`、`video_members.chapters_json`、`video_softwares.order_index`、`video_youtube_metadata.youtube_video_id`

### 名称変更

| 旧名 | 新名 |
| --- | --- |
| `event_staff.approved_by_user_id` | `approved_by_auth_user_id` |
| `video_members.edit_granted_by_user_id` | `edit_granted_by_auth_user_id` |

## 9. 適用対象と事前条件

`0043_db_canonical_migration.sql` は、`flamenode_schema_meta.version='2026-07-11-baseline-1'` で、廃止予定8テーブルがすべて存在し、canonical新規テーブルや `*_new` 途中テーブルが存在しないDBだけを受け付ける。

破壊処理前に次を検査し、満たさない場合はCHECK制約名を含むエラーで停止する。

- 旧DBの外部キー違反が0件。
- `video_members.chapters_json` が有効なJSON配列。
- `videos.youtube_video_id` と旧メタデータの動画IDに不一致・有効作品間重複がない。
- canonical化後の `event_staff(event_id, x_user_id)` が重複しない。
- `software_aliases.normalized_alias` が複数softwareへ重複しない。
- イベント状態値が既知の4値のみ。
- 旧 `videos.archived` の分類結果が確定している。

事前検査後にschema versionを `2026-07-20-canonical-1-in-progress` へ更新する。再適用や途中状態は正常な正本として扱わず明示的に停止する。

## 10. 必須の移行順序

1. **事前検査**: D1バックアップ、件数、NULL率、重複、孤児、owner不在、旧状態値を記録する。
2. **新構造追加**: 新テーブル・新カラムを追加し、旧構造は残す。
3. **バックフィル**: X申請、アカウントリンク、owner、チャプター、YouTube ID、監査設定、状態値を変換する。
4. **読取切替**: すべての読取を新正本へ統一する。
5. **書込切替**: 旧構造への書込を停止する。
6. **制約確定**: NOT NULL、複合PK、FK、CHECK、indexを確定する。
7. **旧構造削除**: 事前条件を満たす場合だけ削除する。
8. **正本化完了**: 41テーブル・409カラムと旧参照0件を機械検証し、schema versionを確定する。

SQLite/D1で安全に直接削除できない場合は、`new table → copy → assert → swap` を使用する。

## 11. D1適用方式

D1では `PRAGMA foreign_keys=OFF` と一時テーブル作成を使用せず、`PRAGMA defer_foreign_keys=ON` とmigration専用の通常テーブルを使用する。親テーブル再作成時は参照行を退避・復元し、migration専用テーブルを最終検査前後に削除する。D1内部の `d1_migrations` と `_cf_*` は41テーブル・409カラムの集計対象外とする。

D1が禁止する `PRAGMA integrity_check` はmigration内で実行せず、`PRAGMA quick_check` を使用する。完全な `integrity_check` はNode SQLite側のCI検査で実行する。

## 12. 旧形式インポート

- JSON、CSV、TSVの旧入力解析は維持する。
- previewは `spreadsheet_import_runs.nonce` とplan hashで一度限りにする。
- canonical plan本体はR2へ短期保存する。
- applyは41テーブルの新正本だけへ書き込む。
- 旧入力、hash、parser版、警告、不一致、適用結果を監査・移行レポートへ残す。
- `legacy_import_batches` と `legacy_import_batch_items` をランタイム正本にしない。

## 13. 検証条件

### 構造・データ

- 41テーブル・409カラム。
- 旧8テーブル、旧25カラム、旧名称2件が不存在。
- DrizzleとD1実スキーマが一致。
- 外部キー違反、孤児、複合キー重複が0件。
- 旧申請3テーブルと `x_identity_requests` の移行件数が一致。
- 直接userリンクから作成すべき `x_user_account_links` が欠落しない。
- `chapters_json` の有効要素数と移行チャプター増分が一致。
- YouTube動画IDの不一致が0件。
- イベント状態が `private` / `public` 以外に残らない。
- 未分類の旧 `videos.archived` が0件。

### 業務不変条件

- 全イベントにownerが1人以上いる。
- owner移譲は同一トランザクションで完了する。
- `events.max_slots_per_video` の値が保持される。
- イベント開催段階・募集段階が日時から正しく算出される。
- 権限判定、公開API、CSV、監査復元、YouTube同期、旧形式インポートが新正本で動作する。

### 機械検証・CI

`npm run check:db-migration`、`npm run check:db-d1-empty`、`npm run check:db-d1-legacy` に加え、型検査、Lint、Unit / Worker / 統合テスト、Next.js / Cloudflare Pages build、文書・DB履歴検査がすべて成功するまでレビュー可能・マージ可能と扱わない。

## 14. ロールバック

逆migrationは提供しない。適用前のD1バックアップと0043適用前アプリケーションを同時に復元する。`in-progress` を検知した場合も残存構造へ追加操作せず、同じ手順で復元する。

新旧ID対応、件数、警告、不一致、状態変換結果を保存し、ロールバック時もowner不変条件と監査ログ整合性を維持する。

## 15. 完了条件

- 実DB、Drizzle、migration、API、管理画面、CSV、外部出力、監査復元が同じ正本を使用する。
- 旧DB構造へのランタイム参照が0件。
- 空DBと旧データ入りDBの両方でmigrationが成功する。
- すべての構造・件数・状態・owner検査とCIが成功する。
- 明示的に廃止した機能以外の挙動が維持される。
- 復元手順が実行確認済みである。
