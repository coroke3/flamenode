# DB変更履歴

> Status: Active
> Last verified: 2026-07-12
> Source of truth: `src/lib/db/schema.ts`, `migrations/` active path

## 2026-07-13 — `0002_terms_reaccept_manual_cost_guard.sql`

| 項目 | 内容 |
| --- | --- |
| Type | destructive cleanup + additive indexes/FK |
| Summary | 規約再同意を履歴からbounded検索する索引と同意user FKを追加し、未計測の自動CostGuard正本を削除 |
| Reason | major公開時の全user更新/COUNTを廃止し、keyset通知をD1 Free枠内で処理する。実測collectorがない自動判定を手動mode/feature/15分overrideへ統一する |
| Data migration | `user_tos_consents`を同一列で再構築し、`user.id`へのcascade FKを追加 |
| Data loss | `cost_usage_snapshots`、`system_settings.auto_cost_guard_enabled`、`cost_guard_thresholds_json`を削除 |
| Rollback | migration前のD1 backupから運用者が手動復元 |
| Validation | `check:db-schema`、`check:db-history`、再同意/CostGuard unit・integration |

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
