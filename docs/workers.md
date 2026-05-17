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
| `youtube-sync` | `0 */6 * * *` | 実装済み | `videos` SELECT/UPDATE | YouTube Data API v3 |
| `score-recalc` | `30 */3 * * *` | 実装済み (簡易) | `videos` UPDATE | なし |

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
- voided 動画の論理削除タイマー (voided_at から 30 日後に is_deleted=1)
- 一時エラー (Throttle/Network/Timeout) を最大 3 回までウォーム内即時リトライ (`runCleanupWithRetry`)
- スキーマエラーはリトライせず即諦める (`shouldRetryCleanupError`)

### 未実装
- voided 動画の R2 サムネ R2 オブジェクト掃除

---

## 4. youtube-sync (実装済み)

- 根拠: `workers/youtube-sync/index.ts`, `wrangler.toml`

### 実装済み
- 公開済み動画の youtube_video_id を 50 件単位で同期
- YouTube Data API v3 の videos.list 呼び出し
- 削除/限定公開検出
- `youtube_synced_at` を更新

### 未実装
- API クォータ枯渇時の自動バックオフ
- サムネ R2 ミラー
- 同期失敗のリトライキュー

---

## 5. score-recalc (実装済み・簡易)

- 根拠: `workers/score-recalc/index.ts`, `wrangler.toml`

### 実装済み
- `videos.video_score = views * 1 + likes * 5 - 経過日数 * 0.1`
- 3 時間ごと全件更新 (status=public, is_deleted=0)

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
