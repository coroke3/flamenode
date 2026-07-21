# FlameNode DB正本移行仕様

> Status: Active  
> Last verified: 2026-07-20  
> Verified against commit: `89e3014`  
> Source of truth: `src/lib/db/schema.ts`, `src/lib/db/schema.canonical.ts`, `migrations/0043_db_canonical_migration.sql`  
> Canonical schema version: `2026-07-20-canonical-1`

## 1. 方針

FlameNodeは本格運用前のため、旧DB構造、旧API、旧状態値に対する通常ランタイムの後方互換を提供しない。

旧DBからの既存データ変換はD1 migrationで一回限り実施する。加えて、移行後に保管済みの旧JSON / CSV / TSVを取り込む必要がある場合だけ、管理者専用の`/admin/import`と`/api/admin/import/legacy`を旧形式入力アダプターとして使用する。通常ランタイム、公開API、Workerは新正本だけを読み書きし、旧列fallback、旧DTO出力、旧状態の自動補正、dual-read、dual-writeを残さない。

矛盾がある場合は次の順で判断する。

1. 本書の禁止事項と不変条件
2. `src/lib/db/schema.canonical.ts`
3. `migrations/0043_db_canonical_migration.sql`
4. 現行ランタイムコード
5. Historical文書と過去migration

## 2. 確定値

| 項目 | 値 |
| --- | ---: |
| 正本テーブル | 41 |
| 正本カラム | 409 |
| 廃止・統合テーブル | 8 |
| 削除対象旧カラム | 25 |
| 名称変更 | 2 |

## 3. 後方互換を残さない対象

次の機能・分岐は正本移行と同時に削除する。

- 旧状態を通常フォームや公開APIで受理し、自動補正するランタイム分岐
- 旧テーブル・旧カラムが存在する場合だけ処理を変えるfallback
- 新旧両方へ書き込むdual-write
- 新旧DTOを同時に公開する互換レスポンス
- `format=legacy`などの旧形式出力
- 削除済みカラムを許容する型、optional property、`any` cast
- 旧形式を管理者専用インポート境界の外で解釈する共通ヘルパー

旧形式入力は次の境界だけに隔離する。

- 管理画面: `/admin/import`
- 管理者API: `/api/admin/import/legacy`
- 実装名前空間: `src/lib/import/legacy/`
- 処理順: parse → normalize → preview → preflight → apply
- 保存先: 新41テーブルの正本だけ
- 安全条件: 管理者限定、preview必須、利用者・plan hash固定、容量・行数・D1上限、監査、手動作成データの非上書き

Historical migration、移行fixture、削除確認スクリプトは、移行検証と監査証跡のために残してよい。ただし通常ランタイムから参照してはならない。

## 4. 移行順序

1. 0043適用前のD1バックアップを取得する。
2. 旧schema version、外部キー、重複、owner、状態値、JSONチャプター、YouTube IDを検査する。
3. 新テーブル・新カラムを作成する。
4. 旧データを新正本へバックフィルする。
5. 件数、主キー、外部キー、値、owner、チャプター、YouTube IDを照合する。
6. schema versionを`2026-07-20-canonical-1-in-progress`としてランタイム切替前状態を明示する。
7. アプリケーションの読み書きを新正本だけへ切り替える。
8. 旧構造へのランタイム参照が0件であることを検査する。
9. 旧テーブル・旧カラム・旧indexを削除する。
10. 全検査成功後だけschema versionを`2026-07-20-canonical-1`へ確定する。

旧構造削除後のアプリケーションrollbackは提供しない。問題発生時はD1バックアップと0043適用前アプリケーションを同時に復元する。

## 5. 禁止事項

- `events.max_slots_per_video`を削除または別用途化しない。
- 最後のイベントownerを削除、降格、退出、無効化しない。
- YouTube動画IDを複数テーブルへ二重保存しない。
- `video_members.chapters_json`を照合なしで破棄しない。
- `videos.visibility_status='archived'`を根拠なしで一律変換しない。
- 旧構造の存在を前提にしたランタイムfallbackを追加しない。
- 旧形式インポートを管理者専用境界の外へ広げず、旧列・旧テーブルへ書き戻さない。
- 未確定のテーブル追加、削除、統合、名称変更を0043へ混ぜない。

## 6. 状態モデル

### イベント

保存値は`private`と`public`だけとする。

| 旧値 | 新値 |
| --- | --- |
| `draft` | `private` |
| `private` | `private` |
| `public` | `public` |
| `archived` | `public` |

開始前、開催中、終了済みは`start_time`と`end_time`から算出する。募集前、募集中、募集終了は`entry_start_time`と`entry_end_time`から算出する。段階値をDBへ重複保存しない。

### 作品

- `draft`は原則`private`へ移行する。
- `archived`は件数、理由、参照状況を確認し、各行を`private`または`voided`へ分類する。
- 分類不能な`archived`が1件でも残る場合、破壊処理を停止する。
- YouTube限定公開はFlameNode公開状態と分離し、YouTubeプライバシー情報として保存する。
- migration後に`draft`、`limited`、`hidden`、`archived`を受け付ける互換分岐を残さない。

## 7. 横断的不変条件

| 領域 | 正本 | 廃止する表現 |
| --- | --- | --- |
| X名義と認証ユーザー | `x_user_account_links` | `x_users.linked_user_id`、`event_staff.user_id`、`video_members.user_id` |
| X ID申請 | `x_identity_requests` | 旧申請3テーブル |
| イベントowner | `event_staff.permission_preset='owner'` | `events.representative_x_user_id` |
| スタッフ権限 | `permission_preset` | `event_staff.role` |
| 公開肩書 | `public_role_label` | 権限値との兼用 |
| イベントグループ順 | `events.start_time DESC, events.created_at DESC` | `event_group_events.sort_order` |
| 枠上限 | `events.max_slots_per_video` | `max_consecutive_slots_per_entry` |
| 公開API更新判定 | `events.updated_at`と`audit_logs` | `events.public_api_updated_at` |
| チャプター | `video_chapters`、`chapter_time ASC, id ASC` | `chapters_json`、`show_on_player_bar`、`order_index` |
| 使用ソフト順 | `software_catalog.name ASC, raw_label ASC` | `video_softwares.order_index` |
| YouTube動画ID | `videos.youtube_video_id` | `video_youtube_metadata.youtube_video_id` |
| いいね・保存 | `(x_user_id, video_id, interaction_type)` | 独立ID、外部同期列 |
| 監査設定 | `system_settings.audit_*` | `audit_log_settings`、`history_retention_days` |
| データ投入 | 管理スプレッドシート、正本API、管理者専用旧形式インポート | 通常ランタイムでの旧形式解釈 |

## 8. 正本テーブル

正確な型、NULL制約、外部キー、CHECK、indexは`src/lib/db/schema.canonical.ts`を参照する。

| 領域 | テーブル | カラム |
| --- | --- | ---: |
| X | `x_identity_requests` | 12 |
| X | `x_user_account_links` | 6 |
| X | `x_user_aliases` | 2 |
| X | `x_users` | 9 |
| イベント | `event_group_events` | 5 |
| イベント | `event_groups` | 12 |
| イベント | `event_staff` | 12 |
| イベント | `event_templates` | 8 |
| イベント | `events` | 27 |
| イベント | `slots` | 13 |
| システム | `flamenode_schema_meta` | 3 |
| システム | `system_settings` | 17 |
| ソフト | `software_aliases` | 3 |
| ソフト | `software_catalog` | 9 |
| 作品 | `video_chapters` | 9 |
| 作品 | `video_events` | 2 |
| 作品 | `video_interactions` | 4 |
| 作品 | `video_members` | 12 |
| 作品 | `video_moderation_cases` | 14 |
| 作品 | `video_softwares` | 3 |
| 作品 | `video_youtube_metadata` | 9 |
| 作品 | `videos` | 28 |
| 外部連携 | `event_youtube_playlist_items` | 6 |
| 外部連携 | `event_youtube_playlist_sync` | 14 |
| 外部連携 | `external_api_quota_usage` | 5 |
| 投稿フォーム | `event_custom_questions` | 15 |
| 投稿フォーム | `video_custom_answers` | 7 |
| 監査 | `audit_logs` | 20 |
| 監査 | `audit_restore_runs` | 7 |
| インポート | `spreadsheet_import_runs` | 9 |
| 規約 | `terms_versions` | 9 |
| 規約 | `user_tos_consents` | 5 |
| 認証 | `account` | 11 |
| 認証 | `session` | 3 |
| 認証 | `user` | 17 |
| 認証 | `verificationToken` | 3 |
| 通知 | `announcements` | 11 |
| 通知 | `notification_outbox` | 15 |
| Worker | `static_artifacts` | 9 |
| Worker | `static_rebuild_queue` | 16 |
| Worker | `worker_leases` | 8 |

**合計: 41テーブル / 409カラム**

## 9. 廃止テーブル

| 旧テーブル | 移行先 |
| --- | --- |
| `x_account_link_requests` | `x_identity_requests` |
| `x_id_merge_requests` | `x_identity_requests` |
| `x_id_merge_reverts` | `x_identity_requests` |
| `x_user_icons` | `x_users.icon_url`、`videos.creator_icon_url` |
| `x_user_youtube_channels` | `x_users.youtube_channel_url`、`videos.creator_youtube_channel_url` |
| `legacy_import_batch_items` | 削除。インポート計画はR2の短期previewと監査ログで保持 |
| `legacy_import_batches` | 削除。インポート実行状態を旧DB表へ保存しない |
| `audit_log_settings` | `system_settings.audit_*` |

## 10. 削除対象旧カラム

`x_users.linked_user_id`、`x_users.verification_token`、`x_users.token_expires_at`、`x_users.approval_requested_at`、`event_group_events.sort_order`、`event_staff.user_id`、`event_staff.role`、`event_staff.internal_note`、`events.representative_x_user_id`、`events.max_consecutive_slots_per_entry`、`events.public_api_updated_at`、`slots.slot_kind`、`slots.priority_reclaim_video_id`、`slots.priority_reclaim_until`、`system_settings.history_retention_days`、`software_aliases.id`、`video_chapters.show_on_player_bar`、`video_chapters.order_index`、`video_interactions.id`、`video_interactions.source`、`video_interactions.synced_at`、`video_members.user_id`、`video_members.chapters_json`、`video_softwares.order_index`、`video_youtube_metadata.youtube_video_id`

### 名称変更

| 旧名 | 新名 |
| --- | --- |
| `event_staff.approved_by_user_id` | `approved_by_auth_user_id` |
| `video_members.edit_granted_by_user_id` | `edit_granted_by_auth_user_id` |

## 11. 完了条件

- 実DBとDrizzleが41テーブル・409カラムで一致する。
- 廃止テーブル8件が存在しない。
- 削除対象旧カラム25件が存在しない。
- 旧名称2件が存在せず、新名称2件が存在する。
- 通常ランタイム、公開API、Workerに旧構造・旧形式分岐がない。
- `/admin/import`、`/api/admin/import/legacy`、`src/lib/import/legacy/`が管理者専用境界として存在する。
- JSON / CSV / TSVのparse・normalize・preview・preflight・applyテストが成功する。
- インポート結果が新正本だけへ保存され、手動作成データを`replace_imported`で上書きしない。
- 旧インポート専用DBテーブルと旧列への書き戻しがない。
- 外部キー違反、孤児、複合主キー重複が0件である。
- 全イベントにownerが1人以上存在する。
- `events.max_slots_per_video`の既存値が一致する。
- チャプター移行件数、時刻、担当者が一致する。
- YouTube動画IDの正本が`videos.youtube_video_id`だけである。
- typecheck、lint、unit、worker、integration、OpenNext / Cloudflare Workers buildが成功する。
- 空DBと旧データ入りDBの両方でmigrationが成功する。
- バックアップからの復元手順を確認する。
