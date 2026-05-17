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
| `0004_tough_kronos.sql` | video_members.name_for_sort 追加 + バックフィル + index | nullable 列 + UPDATE。バックフィル時間に注意 |
| `0005_curvy_karnak.sql` | notification_outbox に status/event_id インデックス | CREATE INDEX のみ、ロールバック不要 |

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
| `migrations/0004_tough_kronos.sql` | `video_members.name_for_sort` (lower(name) キャッシュ) 追加 + 既存行バックフィル + index |
| `migrations/0005_curvy_karnak.sql` | `notification_outbox` に `(status, created_at)` / `(event_id)` インデックス追加 |

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
| `json-generator` | `*/10 * * * *` | `top.json` / `event/{id}.json` を R2 に出力 | (R2 / KV bind) |
| `cleanup` | `0 */1 * * *` | 期限切れ slot 解放 / 古い通知削除 | なし |
| `youtube-sync` | `0 */6 * * *` | YouTube 再生数・サムネ等の同期 | `YOUTUBE_API_KEY` |
| `score-recalc` | `30 */3 * * *` | `videos.video_score` 再計算 | なし |

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

- `videoComments` / `video_comments` の新規利用 (J-1: deprecated)
- `outro_comment` への書き込み (J-3: `closing_comment` に統一)
- `marker_kind` に `"chapter"` 以外を値として代入 (J-2: MVP は chapter 固定)

allowlist (許可される定義/参照ファイル):

- `src/lib/db/schema.ts` — スキーマ定義そのもの
- `src/lib/legacy/normalize.ts` — 旧データ正規化
- `src/lib/admin/healthChecks.ts` — deprecated 行検出

### 5-1. ランタイム検査

`/admin/health` に以下の deprecated チェックが追加されている。

- `video_comments_legacy_rows` — `video_comments` の残行 (>0 で WARN)
- `videos_outro_comment_legacy` — `videos.outro_comment IS NOT NULL` (>0 で INFO)
- `chapter_non_chapter_marker` — `video_chapters.marker_kind != 'chapter'` (>0 で INFO)

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

`/admin/security` で `access_token` 残存、rejected X ID active、未承認投稿、BAN/TOS 未同意の書き込み、custom_pages 危険 HTML を検出。

### 6-5. 危険操作

削除・無効化・却下・一括操作は `ConfirmDialog` 経由で影響件数を表示。確認文字列が必要な操作は別途。
全件物理削除は復元機能未実装のため原則禁止。

---

## 7. 関連ドキュメント

- 設計正本: `.claude/flamenode/source/flamenode_final_detailed_design.md`
- 要求マップ: `.claude/flamenode/requirements-map.md`
- 実装チェックリスト: `.claude/flamenode/source/flamenode_final_implementation_checklist.md`
- 通知/Worker 監査: `.claude/flamenode/source/ops-notifications-workers-audit.md`
- セッション引き継ぎ: `.claude/session-handoff.md`
