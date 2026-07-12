# DB変更履歴

> Status: Active
> Last verified: 2026-07-12
> Source of truth: `src/lib/db/schema.ts`, `migrations/` active path

## 2026-07-13 — `0001_spreadsheet_import_runs.sql`

| 項目 | 内容 |
| --- | --- |
| Type | additive |
| Summary | Spreadsheet preview tokenをHMAC署名し、一回限りnonceをD1で原子的に消費する |
| Reason | stable SHA256一致だけではtokenを偽造・再利用できるため、実行者・payload・schema・期限を署名してreplayを防止する |
| Data migration | なし。新規短期run tableのみ |
| Data loss | none |
| Rollback | manual |
| Validation | `check:db-schema`、`check:db-history`、unit/integration |

## 2026-07-11 — `0000_flame_node_baseline.sql`

| 項目 | 内容 |
| --- | --- |
| Type | baseline |
| Summary | 最終canonical schemaを空D1へ一括作成 |
| Reason | schemaとactive pathを一意化し、起動時の自動スキーマ適用・旧列fallback・二重書き込みを現行方式から除外 |
| Data migration | なし。旧migration本文は `migrations/historical/` に保存 |
| Data loss | intentional。Remote D1や本番データを自動変更しない |
| Rollback | not safely reversible。運用者がbackupから復旧 |
| Validation | `check:db-schema`、`check:db-history`、空SQLite/D1へのbaseline適用 |

新しいactive migrationを追加する場合は、schema、SQL、テンプレート準拠のヘッダー、本文の変更理由、検査結果を同じ変更へ記録する。
