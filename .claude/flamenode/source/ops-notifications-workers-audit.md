# FlameNode 通知/Worker 監査ドキュメント

作成日: 2026-05-17
対象バッチ: `ops/notifications-workers-audit`

---

## 1. notification_outbox テーブルスキーマ

根拠ファイル: `src/lib/db/schema.ts` (L539-L553)

| カラム | 型 | 説明 |
|---|---|---|
| `id` | text PRIMARY KEY | 通知レコードID |
| `discord_user_id` | text NOT NULL | 送信先 Discord ユーザー ID |
| `type` | text NOT NULL | 通知種別 (文字列自由) |
| `payload_json` | text NOT NULL | 通知本文 JSON |
| `status` | text | `pending` / `processing` / `sent` / `failed` デフォルト `pending` |
| `attempt_count` | integer | リトライ試行回数 デフォルト 0 |
| `next_attempt_at` | integer | 次回試行予定 UNIX 秒 (NULL = 即時) |
| `last_error` | text | 直近エラーメッセージ |
| `created_at` | integer | 作成日時 UNIX 秒 (デフォルト unixepoch()) |

### 注意点

- 2026-05-17 修正: `workers/notification-dispatcher/index.ts` を `notification_outbox` の実カラムに整合済み。スキーマ乖離は解消。
- 旧 Worker は `notifications` テーブルを叩いていたが、`migrations/0000_brave_iceman.sql` には `notification_outbox` しか定義されていないため、旧 Worker は実質ノーオペレーションだった。

---

## 2. Worker 構成

根拠ファイル: `workers/notification-dispatcher/index.ts` / `workers/notification-dispatcher/wrangler.toml`

### wrangler.toml 設定

| 項目 | 値 |
|---|---|
| name | `flamenode-notification-dispatcher` |
| main | `index.ts` |
| compatibility_date | `2026-01-01` |
| triggers / crons | `*/5 * * * *` (5 分間隔) |
| D1 binding | `DB` / `flamenode_db` |

### 環境変数

| 変数名 | 用途 |
|---|---|
| `DISCORD_WEBHOOK_URL` | Discord Webhook エンドポイント (省略可) |
| `DISCORD_BOT_TOKEN` | Discord Bot トークン (現在未使用) |

---

## 3. リトライ仕様

根拠ファイル: `workers/notification-dispatcher/index.ts`

```
MAX_RETRIES = 3
BACKOFF_BASE_SEC = 60   // 指数バックオフ基数
```

- Cron 起動ごとに `status = 'pending' AND attempt_count < 3 AND (next_attempt_at IS NULL OR next_attempt_at <= now)` のレコードを最大 50 件取得。
- 処理開始時に `status = 'processing'` で排他し、`deliver()` 成功で `status = 'sent'`。
- 失敗時:
  - `attempt_count += 1`
  - `attempt_count >= MAX_RETRIES` なら `status = 'failed'` + `last_error`
  - それ以外は `next_attempt_at = now + 60 * 2^(attempt_count-1)` で指数バックオフ。

### チャネル対応状況

| チャネル | 実装状況 |
|---|---|
| `discord_webhook` | 実装済み (`DISCORD_WEBHOOK_URL` が設定されている場合のみ稼働) |
| `discord_dm` | 実装済み (`DISCORD_BOT_TOKEN` 必須。`/users/@me/channels` で DM チャネル作成後にメッセージ送信) |

---

## 4. 監視ポイント

### 確認推奨クエリ (D1 コンソール)

```sql
-- 失敗レコード確認
SELECT id, type, attempt_count, last_error, created_at
FROM notification_outbox
WHERE status = 'failed'
ORDER BY created_at DESC LIMIT 20;

-- 処理待ちキュー確認
SELECT status, COUNT(*) AS cnt
FROM notification_outbox
GROUP BY status;
```

### 運用上のアラートタイミング

- `status = 'failed'` が増加傾向 (閾値目安: 10 件超え)
- `status = 'pending'` の `attempt_count = 2` が多い (次回で failed 確定)
- `DISCORD_WEBHOOK_URL` が未設定のまま本番デプロイした場合、全通知が `failed` になる

---

## 5. 既知の制限

### 5-1. スキーマ乖離 (解消済み 2026-05-17)

- Worker を `notification_outbox` に整合させる修正で解消。
- 旧 Worker が叩いていた `notifications` テーブルはそもそも存在せず、稼働していなかった (失敗を出していた可能性あり)。

### 5-2. 指数バックオフ (実装済み 2026-05-17)

- `next_attempt_at = now + 60 * 2^(attempt_count - 1)` で 60s → 120s → 240s の遅延再試行を実装。
- Cron 周期 5 分よりも長いバックオフは次々回以降の Cron で再評価される。

### 5-3. Discord DM (実装済み 2026-05-17)

- `DISCORD_BOT_TOKEN` を使って `/users/@me/channels` で DM チャネルを作成し、`/channels/{id}/messages` でメッセージ送信。
- `payload_json` をそのまま POST body として使う設計のため、payload 構築側でメッセージ仕様を満たすこと。

### 5-4. サイト内通知未実装

- 仕様書 (claude-code-subagent-assignment.md §19) ではサイト内通知も要件だが、未実装。
- `notification_outbox.type` は文字列フリーであり、サイト内通知専用チャネルの追加が必要。

### 5-5. 物理 fetch の HTTPS 依存

- `deliver()` は `fetch()` を使うため、Cloudflare Workers 外環境では動作しない。
- ローカル開発時のテストは別途モック必要。

---

## 6. 実装状況サマリ

| 機能 | 状況 |
|---|---|
| notification_outbox スキーマ定義 | 実装済み |
| Worker Cron (5 分間隔) | 実装済み |
| Discord Webhook 送信 | 実装済み |
| 最大 3 回リトライ | 実装済み |
| Discord DM 送信 | 実装済み (2026-05-17) |
| 指数バックオフ | 実装済み (2026-05-17) |
| next_attempt_at 活用 | 実装済み (2026-05-17) |
| サイト内通知チャネル | 未実装 |
| Worker と ORM スキーマの一致 | 解消済み (2026-05-17) |
| 通知失敗履歴の管理画面表示 | 未実装 (`/admin/audit` で history_logs は閲覧可) |

