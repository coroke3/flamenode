# FlameNode 運用手順

最終更新: 2026-05-17

本ドキュメントは管理者・運営者向けの運用手順をまとめたものである。
設計の正本は `.claude/flamenode/source/` 配下、実装の正本は `src/` `app/` `workers/` 配下。

## 目次

1. [Migration 適用](#1-migration-適用)
2. [Rollback 手順](#2-rollback-手順)
3. [Worker 運用](#3-worker-運用)
4. [Public API 漏洩検査](#4-public-api-漏洩検査)
5. [DB Legacy 検査](#5-db-legacy-検査)
6. [管理者向け操作メモ](#6-管理者向け操作メモ)

---

## 1. Migration 適用

### 1-1. 生成

スキーマ (`src/lib/db/schema.ts`) を変更したら drizzle-kit で migration を生成する。

```sh
npm run db:generate
```

生成された SQL は `migrations/NNNN_<slug>.sql` に出力される。コミット前に内容を必ずレビューする。

### 1-2. ローカル D1 へ適用

```sh
npm run db:local-apply
```

内部的には `wrangler d1 migrations apply flamenode_db --local` が走る。
ローカルの SQLite ファイル (`.wrangler/state/v3/d1/`) に変更が反映される。

### 1-3. 本番 D1 へ適用

```sh
wrangler d1 migrations apply flamenode_db --remote
```

実行前に必ず

- 本番停止時間帯か / 影響範囲を確認
- migration が単方向 (DROP / ALTER COLUMN など) なら 2-3 の rollback を先に検討

#### 現在未適用の migration (本番)

`.claude/session-handoff.md` の「既知の未適用」セクションも参照。

| migration | 内容 | 安全性 |
|---|---|---|
| `0001_young_fat_cobra.sql` | events.entry_start_time / entry_end_time 追加 | nullable 列追加のみ、ロールバック不要 |
| `0002_hot_colleen_wing.sql` | notification_outbox.event_id 追加 | nullable 列追加のみ、ロールバック不要 |
| `0003_loose_whiplash.sql` | video_members に order_index / name インデックス | CREATE INDEX のみ、ロールバック不要 |
| `0018_simplify_video_schema.sql` | video_members.chapters_json へメンバー担当チャプター統合、name_for_sort 廃止 | 本番前 clean schema 用の破壊的整理 |
| `0019_clean_staff_software_and_disabled_features.sql` | event_staff / event_staff_permissions、software 正本化、初期無効化 feature の整理 | 本番前 clean schema 用の破壊的整理 |
| `0020_split_video_core_metadata_stats.sql` | videos 本体を細くし、video_youtube_metadata / video_stats / video_moderation_cases へ責務分離 | 本番前 clean schema 用の破壊的整理 |
| `0005_curvy_karnak.sql` | notification_outbox に status/event_id インデックス | CREATE INDEX のみ、ロールバック不要 |
| `0006_fearless_captain_america.sql` | events.slot_part_gap_minutes (default 30) 追加 | nullable 列追加のみ、ロールバック不要 |

推奨適用順:

```sh
# 1. 本番 dump
wrangler d1 export flamenode_db --remote --output backup-$(date +%Y%m%d).sql

# 2. 適用 (4 件まとめて)
wrangler d1 migrations apply flamenode_db --remote
```

適用後は `/admin/health` を開き warn の数が増えていないことを確認する。

### 1-4. 既存 migration 一覧

| ファイル | 内容 |
|---|---|
| `migrations/0000_brave_iceman.sql` | 初期スキーマ |
| `migrations/0001_young_fat_cobra.sql` | `events.entry_start_time` / `events.entry_end_time` 追加 |
| `migrations/0002_hot_colleen_wing.sql` | `notification_outbox.event_id` 追加 (event-scoped 通知用) |
| `migrations/0003_loose_whiplash.sql` | `video_members` に `(video_id, order_index)` / `(video_id, name)` インデックス追加 (列ソート高速化) |
| `migrations/0018_simplify_video_schema.sql` | `video_members.chapters_json` 追加、`video_member_chapters` / `name_for_sort` 廃止 |
| `migrations/0019_clean_staff_software_and_disabled_features.sql` | `event_staff` / `event_staff_permissions`、`video_softwares`、disabled features を整理 |
| `migrations/0020_split_video_core_metadata_stats.sql` | `videos` の旧互換列を整理し、YouTube メタデータと統計を別テーブルへ移行 |
| `migrations/0021_slim_mvp_drop_unused_tables.sql` | `video_comments` / `dashboard_metrics_cache` を削除し、MVP の D1 書き込み対象を整理 |
| `migrations/0005_curvy_karnak.sql` | `notification_outbox` に `(status, created_at)` / `(event_id)` インデックス追加 |
| `migrations/0006_fearless_captain_america.sql` | `events.slot_part_gap_minutes` (default 30) 追加 |

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

`workers/` 配下の 5 つの Cloudflare Workers はそれぞれ独立した cron で動く。

| Worker | cron | 用途 | 必須環境変数 |
|---|---|---|---|
| `notification-dispatcher` | `*/5 * * * *` | `notification_outbox` を読み Discord 配信 | `DISCORD_WEBHOOK_URL`, `DISCORD_BOT_TOKEN` |
| `json-generator` | `*/15 * * * *` | `top.json` / `event/{id}.json` を R2 に出力 | (R2 / KV bind) |
| `cleanup` | `0 */1 * * *` | 期限切れ slot 解放 / 古い通知削除 | なし |
| `youtube-sync` | `0 */12 * * *` | YouTube 再生数・公開状態の低頻度同期 | `YOUTUBE_API_KEY` |
| `score-recalc` | `30 */12 * * *` | `video_stats.score` 低頻度再計算 | なし |

### 3-1. デプロイ

```sh
cd workers/<worker-name>
wrangler deploy
```

### 3-2. 監視ポイント

- `notification_outbox.status = 'failed'` の件数増加
- `notification_outbox.status = 'pending'` で `attempt_count = 2` のレコード (次回 failed 確定)
- `youtube-sync` の API クォータ枯渇 (HTTP 403)
- `json-generator` の R2 書き込み失敗

詳細は `.claude/flamenode/source/ops-notifications-workers-audit.md` を参照。

### 3-4. Cloudflare無料枠MVP方針

- `video_comments` は削除済み。通常コメントは持たず、チャプター/メンバー担当は `video_chapters` と `video_members.chapters_json` に寄せる。
- `dashboard_metrics_cache` は削除済み。管理トップは承認待ち・通知失敗・YouTube同期失敗などの対応待ち件数だけを軽量クエリで表示する。
- 公開APIは `/admin/api-endpoints` でイベント単位に有効化し、`/api/event-endpoints/[id]` は公開作品の最小フィールドだけを返す。レスポンスは 5〜10分キャッシュ前提。
- お知らせの公開側取得は `target_audience=all`、公開中かつ期限内、最大3件に制限する。
- `video_stats.app_view_count` は閲覧ごとに更新しない。like/bookmark と低頻度 score 再計算に限定する。
- `cost_usage_snapshots` は高頻度保存しない。`/admin/cost-guard` で最新 snapshot と推奨 mode を確認し、閾値は `system_settings.cost_guard_thresholds_json` で管理する。

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
- `slot_time_overlap` — 同イベント内の時間重複 (スイープ全ペア)
- `like_count_drift` — `video_stats.app_like_count` vs video_interactions 集計差 (±5 閾値)
- `missing_video_stats` / `missing_video_youtube_metadata` — 派生行不足
- `notification_processing_stuck` / `notification_failed_volume` — 通知 outbox の滞留・失敗
- `cost_usage_snapshot_freshness` — usage snapshot の鮮度
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

-- 3. 各バッチ投入後、Worker (5分 cron) が処理し終わるのを待つ
--    notification_outbox.status='pending' が 0 になったら次バッチ
SELECT status, COUNT(*) FROM notification_outbox
  WHERE created_at >= unixepoch() - 600 GROUP BY status;
```

⚠️ **危険性**:
- 一括 `INSERT ... SELECT FROM users` で全件 enqueue は厳禁 (10000 件 / 5req/s = 33 分のロック、失敗時の運用負荷大)
- Worker の `MAX_RETRIES=3` に到達した failed は手動リトライが必要
- 一度走らせる前に必ず staging で 1 ユーザー (自分) だけテスト配信する

---

## 7. 関連ドキュメント

- 設計正本: `.claude/flamenode/source/flamenode_final_detailed_design.md`
- 要求マップ: `.claude/flamenode/requirements-map.md`
- 実装チェックリスト: `.claude/flamenode/source/flamenode_final_implementation_checklist.md`
- 通知/Worker 監査: `.claude/flamenode/source/ops-notifications-workers-audit.md`
- セッション引き継ぎ: `.claude/session-handoff.md`
