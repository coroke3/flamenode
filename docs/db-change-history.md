# DB変更履歴

> Status: Active
> Last verified: 2026-07-12
> Source of truth: `src/lib/db/schema.ts`, `migrations/0000_flame_node_baseline.sql`

## 2026-07-11 — `0000_flame_node_baseline.sql`

| 項目 | 内容 |
| --- | --- |
| Type | baseline |
| Summary | 最終canonical schemaを空D1へ一括作成 |
| Reason | schemaとactive pathを一意化し、runtime migration・旧列fallback・二重書き込みを現行方式から除外 |
| Data migration | なし。旧migration本文は `migrations/historical/` に保存 |
| Data loss | intentional。Remote D1や本番データを自動変更しない |
| Rollback | not safely reversible。運用者がbackupから復旧 |
| Validation | `check:db-schema`、`check:db-history`、空SQLite/D1へのbaseline適用 |

新しいactive migrationを追加する場合は、schema、SQL、テンプレート準拠のヘッダー、本文の変更理由、検査結果を同じ変更へ記録する。
