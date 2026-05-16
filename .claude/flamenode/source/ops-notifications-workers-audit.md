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

- `notification_outbox` は Drizzle ORM スキーマ上に定義済みだが、`workers/notification-dispatcher/index.ts` は現在 `notifications` テーブルを直接 SQL で参照している (スキーマ名の乖離あり)。
- Worker は `notification_outbox` ではなく `notifications` テーブルを参照しており、実際の稼働テーブルと ORM 定義の間に不整合がある。

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

根拠ファイル: `workers/notification-dispatcher/index.ts` (L12-L51)

```
MAX_RETRIES = 3
```

- Cron 起動ごとに `status = 'pending' AND retry_count < 3` のレコードを最大 50 件取得。
- `deliver()` が成功: `status = 'sent'`, `sent_at` を記録。
- `deliver()` が失敗:
  - `retry_count += 1`
  - `retry_count >= MAX_RETRIES` なら `status = 'failed'`, それ以外は `status = 'pending'` のまま。
- 指数バックオフ・遅延再試行ロジックは未実装 (次回 Cron まで待つ形)。

### チャネル対応状況

| チャネル | 実装状況 |
|---|---|
| `discord_webhook` | 実装済み (`DISCORD_WEBHOOK_URL` が設定されている場合のみ稼働) |
| `discord_dm` | 未実装 (`DISCORD_BOT_TOKEN` 未使用) |

---

## 4. 監視ポイント

### 確認推奨クエリ (D1 コンソール)

```sql
-- 失敗レコード確認
SELECT id, type, attempt_count, last_error, created_at
FROM notifications
WHERE status = 'failed'
ORDER BY created_at DESC LIMIT 20;

-- 処理待ちキュー確認
SELECT status, COUNT(*) AS cnt
FROM notifications
GROUP BY status;
```

### 運用上のアラートタイミング

- `status = 'failed'` が増加傾向 (閾値目安: 10 件超え)
- `status = 'pending'` の `attempt_count = 2` が多い (次回で failed 確定)
- `DISCORD_WEBHOOK_URL` が未設定のまま本番デプロイした場合、全通知が `failed` になる

---

## 5. 既知の制限

### 5-1. スキーマ乖離 (要修正)

- ORM 定義: `notification_outbox` テーブル (`src/lib/db/schema.ts`)
- Worker 参照: `notifications` テーブル (`workers/notification-dispatcher/index.ts`)
- Worker が ORM スキーマ外のテーブルを参照しているため、Drizzle から通知レコードを操作できない。
- 修正方針: Worker 側を `notification_outbox` に合わせるか、ORM 側テーブル名を `notifications` に変更するかを Opus 判断で決める必要がある。

### 5-2. 指数バックオフ未実装

- 現在は Cron 周期 (5 分) ごとにリトライする。
- 大量失敗時に同じ宛先へ集中投下するリスクがある。
- `next_attempt_at` カラムは ORM 定義に存在するが Worker では未使用。

### 5-3. Discord DM 未実装

- `DISCORD_BOT_TOKEN` は Env 型に定義されているが、DM 送信ロジックがない。
- Discord Webhook のみで稼働中。

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
| Discord DM 送信 | 未実装 |
| 指数バックオフ | 未実装 |
| next_attempt_at 活用 | 未実装 |
| サイト内通知チャネル | 未実装 |
| Worker と ORM スキーマの一致 | 不整合あり (要修正) |
| 通知失敗履歴の管理画面表示 | 未実装 |

