# FlameNode Worker 実装状況

最終更新: 2026-05-17

L-1 (Worker 実装状況のMarkdown明記) に対応。
本ファイルは `workers/` 配下の Cloudflare Workers ごとに、実装済み・未実装・設計のみを整理する。
詳細運用は `docs/operations.md` を参照。

---

## 一覧

| Worker | cron | 状態 | DB 操作 | 外部 API |
|---|---|---|---|---|
| `notification-dispatcher` | `*/5 * * * *` | 実装済み | `notification_outbox` SELECT/UPDATE | Discord Webhook + Discord Bot DM |
| `json-generator` | `*/10 * * * *` | 実装済み (簡易) | `videos` SELECT | R2 / KV 書き込み |
| `cleanup` | `0 */1 * * *` | 実装済み (最小) | `slots` UPDATE | なし |
| `youtube-sync` | `0 */6 * * *` | 実装済み | `videos` SELECT + `video_youtube_metadata` UPSERT | YouTube Data API v3 |
| `score-recalc` | `30 */3 * * *` | 実装済み (簡易) | `video_stats` UPSERT | なし |

---

## 1. notification-dispatcher (実装済み)

- 根拠: `workers/notification-dispatcher/index.ts`, `wrangler.toml`
- 詳細: `.claude/flamenode/source/ops-notifications-workers-audit.md`

### 実装済み
- `notification_outbox` から pending を最大 50 件取得
- `status='processing'` で排他、deliver 成功で `sent`
- 失敗時の指数バックオフ (`60 * 2^(n-1)` 秒)
- 最大 3 回リトライ後 `failed`
- Discord Webhook 配信 (`DISCORD_WEBHOOK_URL`)
- Discord DM 配信 (`DISCORD_BOT_TOKEN` 経由)
- ORM スキーマと実カラム整合 (2026-05-17)

### 未実装
- サイト内通知 (`notification_outbox.type` に site/in_app 系チャネルが未整備)
- イベント運営者向け受信箱 (K-5)

### 部分実装
- 通知失敗履歴の管理画面 (`/admin/notifications` で notification_outbox を直接閲覧可。リトライ手動トリガはまだない)

---

## 2. json-generator (実装済み・簡易)

- 根拠: `workers/json-generator/index.ts`, `wrangler.toml`

### 実装済み
- `top.json` を R2 に書き出し
- 5〜10 分間隔の cron
- `/rebuild` エンドポイントで手動再生成

### 未実装 (設計上想定だが本実装ではない)
- `event/{id}.json` などイベント別 JSON
- `list.json` 全件 (現在は top のみ)
- 静的 JSON のキャッシュ無効化トリガ (KV 経由)
- 取得失敗時のリトライ・差分検出

---

## 3. cleanup (実装済み・最小)

- 根拠: `workers/cleanup/index.ts`, `wrangler.toml`

### 実装済み
- `slots.priority_reclaim_until` 期限切れ解放
- `slots.x_reapply_required` 期限切れ → `voided`
- `notification_outbox.status = 'sent'` の TTL 削除 (14 日)
- `notification_outbox.status = 'failed'` の TTL 削除 (30 日)
- `history_logs` TTL 削除 (`normal` は system_settings.history_retention_days を参照、デフォルト 90 日 / `long_audit` は normal*4 と 365 日の大きい方)
- voided 動画の後処理タイマーは D1 動画行への直接 UPDATE を行わない
- 一時エラー (Throttle/Network/Timeout) を最大 3 回までウォーム内即時リトライ (`runCleanupWithRetry`)
- スキーマエラーはリトライせず即諦める (`shouldRetryCleanupError`)

### 未実装
- voided 動画の R2 サムネ R2 オブジェクト掃除

### 設計判断: Durable Object 永続化は不要 (Opus #6)

cleanup ジョブは以下の特性により Durable Object 永続化は **不要**:

- **冪等**: TTL 削除 / status 更新は何度実行しても同じ最終状態
- **軽量**: SELECT/UPDATE/DELETE が数本、cron 1 回あたり数秒
- **復帰可能**: 失敗しても次の 1 時間後 cron で同じ処理が再実行される
- **ウォーム内即時リトライ済み**: transient エラーは Batch 81 で対応済み (最大 3 回)

Durable Object 導入の追加コスト (料金 / 設定 / 分散ロック実装) が、得られる利益 (中断耐性) を上回るため採用しない。
将来 Worker が状態を持つ処理 (例: rate-limited な broadcast キュー) を追加する場合に再検討。

---

## 4. youtube-sync (実装済み)

- 根拠: `workers/youtube-sync/index.ts`, `wrangler.toml`

### 実装済み
- 公開済み動画の youtube_video_id を 50 件単位で同期
- YouTube Data API v3 の videos.list 呼び出し
- 削除/限定公開検出
- `video_youtube_metadata.synced_at` / `sync_status` / `duration_seconds` / `view_count` を更新

### 未実装
- API クォータ枯渇時の自動バックオフ
- サムネ R2 ミラー
- 同期失敗のリトライキュー

---

## 5. score-recalc (実装済み・簡易)

- 根拠: `workers/score-recalc/index.ts`, `wrangler.toml`

### 実装済み
- `video_stats.score = app_view_count * 1 + app_like_count * 5 + YouTube 補助値 - 経過日数 * 0.1`
- 3 時間ごと全件更新 (visibility_status='public')

### 未実装 (設計のみ)
- イベント別重み・新着重み
- ユーザーごとの推薦シグナル (J-14) との連携
- 集計キャッシュ更新トリガ (J-17)

---

## 6. 全体未実装 (Worker 横断)

| 項目 | 要求ID | 状態 |
|---|---|---|
| サイト内通知チャネル | K-2 | 未実装 |
| 運営者受信箱 | K-5 | 未実装 |
| 静的 JSON フル生成 | L-2 | 部分実装 |
| 期限切れ処理 (cleanup 拡張) | L-5 | 最小実装 |
| 通知失敗履歴の管理画面 | K-4 | 部分実装 (`/admin/notifications` で閲覧可。手動リトライ未実装) |

---

## 7. 依存環境変数まとめ

| Worker | 必須環境変数 |
|---|---|
| notification-dispatcher | `DISCORD_WEBHOOK_URL`, `DISCORD_BOT_TOKEN` |
| json-generator | (R2 / KV binding) |
| cleanup | なし |
| youtube-sync | `YOUTUBE_API_KEY` |
| score-recalc | なし |

未設定で deploy するとサイレントに no-op になる Worker があるので、本番デプロイ時に必ず `wrangler secret list` で確認すること。
