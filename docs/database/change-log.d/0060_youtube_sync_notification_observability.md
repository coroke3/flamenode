## 2026-08-24 — `0060_youtube_sync_notification_observability.sql`

| 項目 | 内容 |
| --- | --- |
| Type | structural/additive |
| Summary | YouTube playlist の run history / lease、運営 incident 状態、notification_outbox の dm/channel 互換列を追加 |
| Data migration | 既存 notification_outbox を同一列・状態・lease・dedupe を保持して再構築し、`discord_webhook` は channel として backfill |
| Data loss | none |
| Rollback | 検証済みバックアップから復元。新テーブル・列・index は停止確認後に手動削除 |
| Validation | `check:db-schema`、`check:db-migration`、notification dispatcher / playlist execution tests |
| Rollout | migration 手動適用 → schema preflight → web → fast-jobs → content-jobs → sync-jobs |
