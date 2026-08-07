# FlameNode 運用手順（pre-baseline履歴）

> Status: Historical
> Replaced by: `docs/operations/README.md`
> Retained for: baseline再作成前の運用経緯の保存

> このファイル以下の手順・migration一覧・旧列名は現行運用の根拠として使用しない。
> 現行の正本は `docs/operations/README.md` とそこからリンクするActive文書である。

最終更新: 2026-07-06

本ドキュメントは管理者・運営者向けの運用手順をまとめたものである。
DB 実装の正本は `src/lib/db/schema.ts`。設計文書や migration 手順はこの schema に追従させる。

## 目次

1. [Migration 適用](#1-migration-適用)
2. [Rollback 手順](#2-rollback-手順)
3. [Worker 運用](#3-worker-運用)
4. [Public API 漏洩検査](#4-public-api-漏洩検査)
5. [DB Legacy 検査](#5-db-legacy-検査)
6. [管理者向け操作メモ](#6-管理者向け操作メモ)
7. [Discord 通知運用方針](#7-discord-通知運用方針)
8. [DB削減後の旧データインポート方針](#8-db削減後の旧データインポート方針)
9. [静的 JSON / operation_mode / Cloudflare デプロイ](#10-静的-json--operation_mode--cloudflare-デプロイ2026-07-04)
10. [関連ドキュメント](#9-関連ドキュメント)

---

## 1. Migration 適用

### 1-1. 現在の管理方針

現状の `migrations/` には Drizzle が生成した SQL と、手動で追加した SQL migration が混在している。
また `migrations/meta/_journal.json` と snapshot は `0007_dapper_slot_events` までしか追跡していない。

そのため、**現時点で `npm run db:generate` を安易に実行しないこと**。古い snapshot を基準に巨大な差分や逆戻り migration が生成される可能性がある。

当面の正本は次の順序で扱う。

1. 実装上の最終スキーマ: `src/lib/db/schema.ts`
2. 適用済み/適用予定の SQL: `migrations/*.sql`
3. 運用手順と注意: この `docs/operations.md`

Drizzle meta を完全復旧する場合は、`0010` 以降の手動 migration を含めた snapshot を再生成・レビューしてから行う。`_journal.json` だけを追記すると snapshot 不足で `drizzle-kit generate` が壊れるため、journal 単体の手編集はしない。

### 1-2. 生成

スキーマ (`src/lib/db/schema.ts`) を変更したら drizzle-kit で migration を生成する。
ただし、上記の通り meta が欠落しているため、現時点では原則として手動 SQL migration を作成し、既存 schema との差分をレビューする。

```sh
npm run db:generate
```

生成された SQL は `migrations/NNNN_<slug>.sql` に出力される。コミット前に内容を必ずレビューする。

### 1-3. ローカル D1 へ適用

```sh
npm run db:local-apply
```

内部的には `wrangler d1 migrations apply flamenode_db --local` が走る。
ローカルの SQLite ファイル (`.wrangler/state/v3/d1/`) に変更が反映される。

`instrumentation.ts` の `repairLocalSchemaDrift()` はローカル開発DBの救済であり、本番D1には効かない。本番差分の代替にしないこと。

### 1-4. 本番 D1 へ適用

```sh
wrangler d1 migrations apply flamenode_db --remote
```

実行前に必ず

- 本番 dump を取得する
- 本番停止時間帯か / 影響範囲を確認
- migration が単方向 (DROP / ALTER COLUMN / テーブル再構築など) なら 2-3 の rollback を先に検討
- `0018`〜`0021` はテーブル再構築・DROP を含むため、特に本番 dump と staging 適用確認を必須にする

推奨適用順:

```sh
# 1. 本番 dump
wrangler d1 export flamenode_db --remote --output backup-$(date +%Y%m%d).sql

# 2. staging またはローカルのコピーで適用確認
wrangler d1 migrations apply flamenode_db --local

# 3. 本番適用
wrangler d1 migrations apply flamenode_db --remote
```

適用後は `/admin/health` を開き warn の数が増えていないことを確認する。

### 1-5. 既存 migration 一覧

D1 へ適用する場合はファイル名の辞書順を正とする。同じ `0010` prefix の migration が2件あるが、いずれも実在ファイル名単位で扱う。

| 順 | ファイル | 内容 | 分類・安全性 |
|---:|---|---|---|
| 0000 | `migrations/0000_brave_iceman.sql` | 初期スキーマ。旧 `videos.status`、`creator_id`、`video_comments`、`event_editors` 等を含む初期状態 | 初期作成 |
| 0001 | `migrations/0001_young_fat_cobra.sql` | `events.entry_start_time` / `events.entry_end_time` | 安全な列追加 |
| 0002 | `migrations/0002_hot_colleen_wing.sql` | `notification_outbox.event_id` | 安全な列追加 |
| 0003 | `migrations/0003_loose_whiplash.sql` | `video_members` の表示順・名前 index | index 追加 |
| 0004 | `migrations/0004_tough_kronos.sql` | `video_members.name_for_sort` と index、既存値 backfill | 安全な列追加。ただし `0018` で廃止 |
| 0005 | `migrations/0005_curvy_karnak.sql` | `notification_outbox` status/event index | index 追加 |
| 0006 | `migrations/0006_fearless_captain_america.sql` | `events.slot_part_gap_minutes` | 安全な列追加。ただし DEFAULT 30 の旧既定あり。現行実装は NULL fallback 15 |
| 0007 | `migrations/0007_dapper_slot_events.sql` | 既存 `video_events` 欠落補修、YouTube ID partial unique | データ補修 + index 追加。事前重複確認推奨 |
| 0008 | `migrations/0008_xicon_user_url_uniq.sql` | `x_user_icons` 重複削除と unique index | データ補修 + index 追加。候補履歴の重複行を削除するため事前確認推奨 |
| 0009 | `migrations/0009_video_collaborator_permissions.sql` | 旧作品共同編集権限テーブル | 旧中間設計。後続で廃止 |
| 0010a | `migrations/0010_event_parts_and_video_part.sql` | `events.parts_json`, `videos.part` | 安全な列追加 |
| 0010b | `migrations/0010_video_collaborators.sql` | 旧 `video_collaborators` へ移行し `video_collaborator_permissions` を DROP | 旧中間設計。DROP あり、現在は `video_members.can_edit` が正 |
| 0011 | `migrations/0011_event_allow_user_video_links.sql` | `events.allow_user_video_event_links` | 安全な列追加 |
| 0012 | `migrations/0012_worker_notification_hardening.sql` | YouTube同期旧列、通知 processing index | 安全な列追加 + index。YouTube旧列は `0020` で `video_youtube_metadata` へ移行 |
| 0013 | `migrations/0013_video_chapter_member.sql` | `video_chapters.video_member_id` と index | 安全な列追加。現在のメンバー担当チャプター正本は `video_members.chapters_json` |
| 0014 | `migrations/0014_event_user_video_edits.sql` | イベント単位の一般作品編集権限設定 | 安全な列追加 |
| 0015 | `migrations/0015_history_operator_snapshot.sql` | `history_logs.operator_snapshot_json` | 安全な列追加 |
| 0016 | `migrations/0016_video_members_can_edit.sql` | `video_members` に共同編集権限を統合 | 安全な列追加 + 旧データ移行。事前重複確認推奨 |
| 0017 | `migrations/0017_video_member_chapters.sql` | 旧 `video_member_chapters` | 旧中間設計。`0018` で廃止 |
| 0018 | `migrations/0018_simplify_video_schema.sql` | `videos` / `video_members` 再構築、`video_member_chapters` / `video_collaborators` 廃止 | 破壊的/再構築。dump 必須 |
| 0019 | `migrations/0019_clean_staff_software_and_disabled_features.sql` | `event_staff` / 旧 `event_staff_permissions` への移行、旧 `event_editors` / `event_collaborator_permissions` 廃止、software 整理 | 破壊的/再構築。dump 必須 |
| 0020 | `migrations/0020_split_video_core_metadata_stats.sql` | `videos` を現行 core へ再構築、`video_youtube_metadata` / `video_stats` / `video_moderation_cases` 作成 | 破壊的/再構築。dump 必須 |
| 0021 | `migrations/0021_slim_mvp_drop_unused_tables.sql` | `video_comments` / `dashboard_metrics_cache` 削除 | 破壊的 DROP。dump 必須 |
| 0022 | `migrations/0022_event_templates.sql` | `event_templates` | 安全なテーブル追加 + index |
| 0023 | `migrations/0023_static_rebuild_queue.sql` | `static_rebuild_queue` と pending/processing partial unique | 安全なテーブル追加 + index |
| 0024 | `migrations/0024_legacy_import_db_reduction_prep.sql` | `videos` 統計・使用ソフトJSON列、イベント公開API列、旧 `event_staff.permission_keys_json` | 旧DB削減準備。安全な列追加 |
| 0025 | `migrations/0025_add_notification_dedupe_key.sql` | `notification_outbox.dedupe_key` と active partial unique | 安全な列追加 + index |
| 0026 | `migrations/0026_x_user_portfolio_contact.sql` | `x_users.portfolio_contact` | 安全な列追加 |
| 0032 | `migrations/0032_slots_end_time_normalize.sql` | 旧 `slots.end_time` 列を削除、単独 `reservation_group_id` を解除 | 本番前のスロット正規化。連続枠ロジックは `start_time` と部間隔を正本にする |
| 0033 | `migrations/0033_event_staff_permission_mask.sql` | `event_staff.permission_preset` / `permission_mask` / `custom_permission_keys_json` | 旧 `event_staff_permissions` から backfill。以後の判定・新規書き込みは `event_staff` 3列を正本にする |
| 0034 | `migrations/0034_user_can_create_events.sql` | `user.can_create_events` | サイト管理者が開催権限を付与するための安全な列追加 |
| 0035 | `migrations/0035_event_visibility_status.sql` | `events.visibility_status` と index | イベント公開状態の正本。旧 `is_active` / `is_archived` は互換列として同期対象 |
| 0036 | `migrations/0036_backfill_used_software_json.sql` | 旧使用ソフト中間テーブルから `videos.used_software_json` へ backfill | 旧テーブル削除前のデータ移行。既存 JSON がある行は上書きしない |
| 0037 | `migrations/0037_backfill_stage_permission_custom_answers.sql` | 旧 `videos.stage_permission` から `video_custom_answers` へ backfill | 旧ステージ許可列の新規書き込み停止前提。質問定義があるイベントだけ正規化回答へ移行する |

### 1-6. 手動 index / Drizzle meta の注意

以下の partial unique index は手動 SQL migration 由来だが、`src/lib/db/schema.ts` にも表現している。

- `videos_youtube_id_active_uniq`
- `notification_outbox_active_dedupe_uniq`
- `static_rebuild_queue_target_pending_uniq`

`migrations/meta/_journal.json` は `0007` までの履歴しか持たない。今後 Drizzle meta を復旧するまでは、migration の存在確認は `migrations/*.sql` を正とし、`_journal.json` だけで本番適用済み/未適用を判断しない。

手動 SQL migration で列・index・制約を追加する場合は、同じ PR で `src/lib/db/schema.ts`、この migration 一覧、必要に応じて `設計/FlameNode-Design.md` を更新する。Drizzle で表現できない DDL は、schema コメントと本節に「手動 migration 専用」として残す。

---

## 2. Rollback 手順

### 2-1. 原則

- D1 は migration をロールバックするネイティブ機能を持たない。
- 列追加だけの migration はアプリ側がその列に依存していなければ放置可。
- 列削除 / 型変更 / NOT NULL 化を含む migration は事前に dump を取る。

### 2-2. 事前 dump

```sh
# 本番から最新スキーマ + データを取得
wrangler d1 export flamenode_db --remote --output backup-YYYYMMDD.sql
```

### 2-3. 緊急 rollback (アプリ側)

DB 構造はそのままで、アプリ側を 1 つ前のコミットに戻して deploy する。

```sh
git revert <bad-commit-sha>
git push origin main
# 必要なら手動で Pages の Production Deploy をトリガ
```

### 2-4. DB レベル rollback (やむを得ない場合)

1. アプリを停止 (メンテナンスページ切替)
2. `backup-YYYYMMDD.sql` から復元用 SQL を抽出
3. `wrangler d1 execute flamenode_db --remote --file=rollback.sql`
4. アプリを再開

---

## 3. Worker 運用

Current production Cron Workers are `fast-jobs`, `content-jobs`, and `sync-jobs`.
Legacy standalone worker directories are kept as importable modules only.

`workers/fast-jobs`、`workers/content-jobs`、`workers/sync-jobs` の3つの Cron Workers が動く。

| Worker | cron | 用途 | 必須環境変数 |
|---|---|---|---|
| `flamenode-fast-jobs` | `0 * * * *` | `notification_outbox` 配信・スロット締切リマインド（`notification-dispatcher` 統合） | `DISCORD_BOT_TOKEN`、Forum Webhook 3種または legacy `DISCORD_WEBHOOK_URL`（[`workers.md`](./operations/workers.md)） |
| `flamenode-content-jobs` | `15 * * * *` | 静的 JSON 再生成・クリーンアップ（`json-generator` / `cleanup` 統合） | D1 / R2 / KV bind |
| `flamenode-sync-jobs` | `7 * * * *`, `52 * * * *` | YouTube 同期・スコア再計算（`youtube-sync` / `score-recalc` 統合） | `YOUTUBE_API_KEY` |

### 3-1. デプロイ

デプロイ前のローカル検証:

```sh
npx tsc -p workers/tsconfig.json --noEmit
npm run test:workers
```

```sh
npm run workers:deploy
```

個別デプロイ:

```sh
cd workers/fast-jobs && wrangler deploy
cd workers/content-jobs && wrangler deploy
cd workers/sync-jobs && wrangler deploy
```

### 3-2. 監視ポイント

- `notification_outbox.status = 'failed'` の件数増加
- `notification_outbox.status = 'pending'` で `attempt_count = 2` のレコード (次回 failed 確定)
- `sync-jobs` の YouTube API クォータ枯渇 (HTTP 403)
- `content-jobs` の R2 書き込み失敗

詳細は `.claude/flamenode/source/ops-notifications-workers-audit.md` を参照。

### 3-4. Cloudflare無料枠MVP方針

- `video_comments` は削除済み。通常コメントは持たず、チャプター/メンバー担当は `video_chapters` と `video_members.chapters_json` に寄せる。
- `dashboard_metrics_cache` は削除済み。管理トップは承認待ち・通知失敗・YouTube同期失敗などの対応待ち件数だけを軽量クエリで表示する。
- 公開APIは `/admin/api-endpoints` でイベント単位に有効化し、`/api/event-endpoints/[id]` は公開作品の最小フィールドだけを返す。レスポンスは 5〜10分キャッシュ前提。
- お知らせの公開側取得は `target_audience=all`、公開中かつ期限内、最大3件に制限する。
- 新規表示クエリは `videos.score` / `videos.app_like_count` を優先する。`video_stats` は score-recalc worker と旧DB fallback 用に当面残し、即 DROP しない。
- `video_stats.app_view_count` は閲覧ごとに更新しない。like/bookmark と低頻度 score 再計算に限定する。
- Cloudflare 使用量は Cloudflare Dashboard で運用者が確認する。FlameNode は使用量を自動収集せず、`operation_mode` を自動変更しない。
- 無料枠対策としての機能制限（`economy` / `read_only` / `static_only`）は、管理者が `/admin/cost-guard` から手動で mode を変更する場合のみ適用する。

### 3-5. 機能制限とランタイム安全装置の区別

| 種別 | 目的 | 変更方法 | 例 |
| --- | --- | --- | --- |
| **機能制限（admin-only）** | 無料枠・運用判断に応じたユーザー向け機能の段階停止 | `/admin/cost-guard` で `operation_mode` と 15 分一時許可を手動変更。`disabled_features_json` は admin spreadsheet import | `operation_mode`、15 分一時許可、`disabled_features_json`（spreadsheet） |
| **ランタイム安全装置** | invocation 内の暴走・枯渇防止（機能制限ではない） | コード内の固定上限。`operation_mode` は変更しない | D1 budget（40 statements/invocation）、YouTube quota budget、Discord 429 バックオフ、ExternalRequestBudget、Queue batch 上限 |

`publicMode` が KV/D1 解決失敗時に `static_only` へ倒す挙動は、インフラ障害時の fail-closed であり、使用量ベースの自動 CostGuard ではない。

### 3-3. 通知失敗の調査クエリ

```sql
SELECT id, type, attempt_count, last_error, created_at
FROM notification_outbox
WHERE status = 'failed'
ORDER BY created_at DESC LIMIT 20;
```

---

## 4. Public API 漏洩検査

公開 API レスポンスに `discord_id` / `access_token` / `role` 等の禁止キーが含まれていないか自動検査する。

```sh
# dev server を起動した状態で
npm run check:public-api-leaks
# または: node scripts/check-public-api-leaks.mjs http://localhost:3000
```

- exit 0: OK
- exit 1: 禁止キー検出 (デプロイ前にブロックすべき)
- exit 2: fetch 失敗 (dev server 未起動)
- exit 3: HTTP 4xx/5xx または JSON 解析失敗 (API エラーとして修正すべき)

検査対象エンドポイントは `scripts/check-public-api-leaks.mjs` 上部参照。
禁止キーリストは `src/lib/api/publicDto.ts` の `FORBIDDEN_PUBLIC_KEYS` と同期。

---

## 5. DB Legacy 検査

deprecated になった DB カラム / テーブルへの新規利用がコードに混入していないかを静的に検査する。

```sh
npm run check:db-legacy
```

検出対象:

- 削除済み `videoComments` / `video_comments` の再利用
- `outro_comment` への書き込み (J-3: `closing_comment` に統一)
- `marker_kind` に `"chapter"` 以外を値として代入 (J-2: MVP は chapter 固定)

allowlist (許可される定義/参照ファイル):

- `src/lib/legacy/normalize.ts` — 旧データ正規化
- `scripts/check-db-legacy.mjs` — 検査スクリプト自身

### 5-1. ランタイム検査

`/admin/health` (ヘルス) に追加されている主要チェック:

- `system_settings_single_row` — system_settings は global 1 行のみ
- `primary_event_sync` — primary_event_id と video_events の同期
- `orphan_event_ref` / `orphan_video_ref` — 外部キー orphan
- `available_slot_with_video` / `submitted_slot_without_video` — slot 状態整合
- `reservation_group_user_mix` — 連続枠ユーザー混在
- `public_video_without_youtube_id` — 公開動画の YT ID 欠落
- `voided_video_visible` — `visibility_status='voided'` の動画状態確認
- `slot_duplicate_start_time` — 同イベント内で同一開始時刻かつ別 `reservation_group_id` の枠
- `like_count_drift` — `video_stats.app_like_count` vs video_interactions 集計差 (±5 閾値)
- `missing_video_stats` / `missing_video_youtube_metadata` — 派生行不足
- `notification_processing_stuck` / `notification_failed_volume` — 通知 outbox の滞留・失敗
- `open_moderation_cases_overdue` — 期限切れモデレーション case
- `active_api_endpoints_orphan_event` — 公開 API endpoint の event 参照
- `x_id_merge_pending_stale` — X ID 統合申請の放置
- `history_logs_retention_candidates` — normal 監査ログの削除候補
- `videos_outro_comment_legacy` — clean schema では常に 0 件になる削除済み確認
- `chapter_non_chapter_marker` — `marker_kind != 'chapter'` (>0 で INFO)
- `orphan_video_member` — video_members の orphan
- `video_members_chapters_json_invalid` — メンバー担当チャプター JSON の形式不正検出

`/admin/security` (セキュリティ) に追加されている主要チェック:

- `access_token_not_null` — accounts.access_token 残存検出
- `rejected_xid_active` — rejected な X ID が active 化されていないか
- `unapproved_creator_videos` — 未承認 `creator_x_user_id` の動画
- `banned_user_videos` / `tos_not_accepted_user_videos` — 書き込み権限漏れ
- `custom_page_dangerous_html` — sanitizer 漏れ
- `banned_user_chapters` — banned ユーザーがチャプター投稿
- `orphan_approved_xid` — approved X ID で discord 紐付け欠落
- `public_api_leak` (whitelist enforced)
- `notification_table_mismatch` (静的解析)

---

## 5-2. 単体テスト (node:test)

純粋関数の単体テストは Node 標準 `node:test` で実行する。Node 22+ の `--experimental-strip-types` で TS をそのまま読み込む。

```sh
npm run test:unit        # 全テスト (cleanup retention / notif format / youtube / xid / slot grouping / format)
npm run test:workers     # Worker 関連のみ
npm run test:notif       # notification format のみ
npm run test:youtube     # youtube/id ユーティリティのみ
```

テスト追加対象は path alias (`@/`) に依存しない pure 関数に限定する。
alias 依存があるロジックは `*Core.ts` に切り出してからテストする (例: `slotGroupingCore.ts`)。

---

## 6. 管理者向け操作メモ

### 6-1. 管理者付与

```sh
node scripts/grant-admin.cjs <discord_id>
```

### 6-2. 監査ログ確認

`/admin/audit` でテーブル/操作/実行者/件数フィルタが使える。

### 6-3. 整合性検査

`/admin/health` でスロット重複・primary_event 同期・voided 動画整合などを点検 (読み取り専用)。

### 6-4. セキュリティ検査

`/admin/security` で `access_token` 残存、rejected X ID active、未承認投稿、BAN/TOS 未同意の書き込み、custom_pages/custom_themes 無効化状態を検出。

### 6-5. 危険操作

削除・無効化・却下・一括操作は `ConfirmDialog` 経由で影響件数を表示。確認文字列が必要な操作は別途。
全件物理削除は復元機能未実装のため原則禁止。

---

## 6-6. broadcast 通知の手動段階実行手順

`/admin/announcements` / `/admin/rules (major)` の本格 enqueue は未実装 (Opus 判断候補)。
緊急時に手動で段階配信する場合の安全手順:

```sql
-- 1. 対象件数を必ず確認 (/admin/announcements の dry-run プレビューと一致するか)
SELECT COUNT(*) FROM users;                                       -- target_audience=all
SELECT COUNT(DISTINCT linked_discord_user_id)
  FROM x_users WHERE approval_status='approved';                  -- target_audience=creators
SELECT COUNT(*) FROM users WHERE role='admin';                    -- target_audience=admins

-- 2. 50 件ずつバッチ enqueue (Discord rate-limit 5req/s 想定で安全マージン)
--    type は site-internal 用に "announcement_broadcast" などを使い、
--    Worker 側でチャネル別に配信制御する。
INSERT INTO notification_outbox (id, discord_user_id, type, payload_json, status, attempt_count, created_at)
SELECT
  lower(hex(randomblob(16))),
  id,
  'announcement_broadcast',
  json_object('content', '...', 'announcement_id', '...'),
  'pending',
  0,
  unixepoch()
FROM users
ORDER BY created_at DESC
LIMIT 50 OFFSET 0;  -- OFFSET を増やしながら 50 件ずつ

-- 3. 各バッチ投入後、fast-jobs Recovery Cron（毎時0分）が処理し終わるのを待つ
--    notification_outbox.status='pending' が 0 になったら次バッチ
SELECT status, COUNT(*) FROM notification_outbox
  WHERE created_at >= unixepoch() - 600 GROUP BY status;
```

⚠️ **危険性**:
- 一括 `INSERT ... SELECT FROM users` で全件 enqueue は厳禁 (10000 件 / 5req/s = 33 分のロック、失敗時の運用負荷大)
- Worker の `MAX_RETRIES=3` に到達した failed は手動リトライが必要
- 一度走らせる前に必ず staging で 1 ユーザー (自分) だけテスト配信する

---

## 7. Discord 通知運用方針

- 一般ユーザー向け Discord 通知の正本は **`notification_outbox`** とする
- **Discord API への送信は `notification-dispatcher` Worker のみ**（Server Action / リマインド処理から直接送らない）
- 締切前リマインドは **outbox への enqueue のみ**。実送信は dispatcher に任せる
- 1 回の dispatcher / reminder 処理は **最大 50 件**
- **`dedupe_key`** で pending / processing / sent の重複を防ぐ（failed / cancelled は再送可）
- **legacy import / bulk import では通知しない**（`sendNotifications=false` / `notificationBehavior=none` がデフォルト）
- failed は **`/admin/notifications`** から手動リトライ・キャンセル・強制再送できる
- **`static_rebuild_queue` と責務を分ける**（dispatcher は outbox のみ、json-generator はキューのみ）
- 通知ログを **KV に保存しない**（状態は D1 `notification_outbox`。KV は operation_mode ミラー等の低頻度フラグ用）

---

## 8. DB削減後の旧データインポート方針

- 旧イベントはデフォルト **archive** モードで取り込む（管理画面 `/admin/import` の「取り込みモード」）
- すべてのイベントを `is_active=1` にしない。過去イベントは `is_archived=1` として保存する
- `api_endpoints` は作らず、`events.public_api_enabled` を使う（インポート時は 0）
- 新規表示クエリは `videos` の統計列（`app_like_count` / `score` 等）を使う
- `video_stats` は score-recalc worker / 旧DB fallback との dual-write のため当面残す。新規設計では表示正本にしない
- `video_youtube_metadata` は YouTube 同期のため維持し、インポート時も作成する
- `video_softwares` は作らず、`videos.used_software_json` に統合する
- `stage_permission` / legacy `righttype` は、対象イベントに `event_custom_questions` があれば `video_custom_answers` へも同期する
- `event_staff_permissions` へは新規書き込みしない。取り込み時の運営権限は `event_staff.permission_preset` / `permission_mask` / `custom_permission_keys_json` に統合する
- Admin spreadsheet import では旧互換列 (`events.is_active` / `events.is_entry_open` / `events.is_archived`, `videos.custom_answers`, `videos.stage_permission`, `system_settings.cost_guard_mode`, `system_settings.is_maintenance_mode`, `video_chapters.video_member_id`) を読み取り専用として無視する
- Admin spreadsheet import で `video_chapters` を追加する場合、MVP 方針に合わせて `marker_kind` は常に `chapter` に補完する
- `announcements` は作らない（必要なら `system_settings.announcements_json` を管理画面から登録）
- `user_tos_consents` は利用規約同意履歴のため維持する
- インポート後の静的 JSON 再生成は `static_rebuild_queue` に積む
- 大量インポート時は **event** 単位の再生成を基本とし、動画単位の full は明示選択時のみ

ローカル開発では `npm run db:local-apply` または Next 起動時の instrumentation で `0024_legacy_import_db_reduction_prep.sql` を適用できる。ただし instrumentation はローカル救済であり、本番 migration の代替ではない。

---

## 10. 静的 JSON / operation_mode / Cloudflare デプロイ（2026-07-04）

### 10-1. 公開データの正本

| 層 | 役割 |
| --- | --- |
| D1 | 正本（編集・審査・権限） |
| R2 `BUCKET` | 公開用静的 JSON キャッシュ |
| `static_rebuild_queue` | 編集駆動の再生成キュー |

読み取りは `src/lib/publicData/loader.ts` が担当する。
接続済みの主要公開導線は top / `/list` / `/event` / `/event/[id]` / video detail / `/user/[id]`。

1. R2 から JSON を試す
2. `static_json_with_live_overlay`（normal / economy / read_only）なら DB fallback 可
3. ミス時は `static_rebuild_queue` に投入（`static_only` は high のみ）
4. `maintenance` / `static_only` で DB fallback の無限ループは禁止（ページ側で `canFallbackToDatabase` を確認）

### 10-2. operation_mode 正本

| 値 | 意味 |
| --- | --- |
| `normal` | 通常運用 |
| `economy` | 重い処理を抑制 |
| `read_only` | 投稿・編集停止、閲覧は可 |
| `static_only` | 静的 JSON のみで公開（D1 fallback しない） |
| `maintenance` | メンテナンス（管理者以外は軽量表示） |

**書き込み正本は `system_settings.operation_mode` のみ。** `cost_guard_mode` / `is_maintenance_mode` への新規書き込みは禁止（読み取り fallback のみ）。

管理: `/admin/cost-guard` / `/admin/static-builds`

### 10-3. Wrangler bindings（Pages / Workers）

| Binding | 用途 |
| --- | --- |
| `DB` | D1 `flamenode_db` |
| `BUCKET` | R2 静的 JSON + メディア |
| `KV` | operation_mode ミラー・degraded circuit 等 |

ローカル: `npm run pages:dev`（`--d1=DB --r2=BUCKET --kv=KV`）

### 10-4. Cloudflare Pages ビルド

```sh
npm run pages:build
```

出力: `.vercel/output/static` → `wrangler pages deploy`

Workers（json-generator 等）: `npm run workers:deploy`

### 10-5. 本番デプロイ前チェックリスト

- [ ] `npm run typecheck` / `npm run lint`
- [ ] `npm run check:db-legacy`
- [ ] `wrangler d1 migrations apply flamenode_db --remote`（未適用分）
- [ ] repair script（必要時）: `npm run repair:video-event-links -- --remote`
- [ ] `/admin/static-builds` で failed キューが残っていないか
- [ ] `operation_mode` が意図どおりか

### 10-6. Repair / rollback

| スクリプト | 用途 |
| --- | --- |
| `npm run repair:video-event-links` | `primary_event_id` 欠落の `video_events` 補完 |

`--dry-run` で件数確認、`--remote` で本番 D1。

現行baselineには旧`events.event_group_id`が存在しないため、Remote D1を旧形式から
自動repairするscriptは提供しない。pre-baseline環境を整理する場合は、運用者がbackupと
対象を確認し、破棄・再作成または明示的なbaseline適用手順を判断する。

Rollback は migration 前の D1 dump から復元（`wrangler d1 export` / import）。

---

## 9. 関連ドキュメント

- DB 実装正本: `src/lib/db/schema.ts`
- 設計概要: `設計/FlameNode-Design.md`
- 作品DB整理: `設計/FlameNode-Video-Schema-Refactor.md`
- 通知/Worker 監査: `.claude/flamenode/source/ops-notifications-workers-audit.md`
- セッション引き継ぎ: `.claude/session-handoff.md`
