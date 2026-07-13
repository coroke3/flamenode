# DB履歴

> Status: Active
> Last verified: 2026-07-13
> Source of truth: `src/lib/db/schema.ts`, `migrations/` active path

## 区分

| 区分 | 対象 | 扱い |
| --- | --- | --- |
| Active | `migrations/0000_flame_node_baseline.sql` | 空D1へ最初に適用する現行baseline |
| Active | `migrations/0001_spreadsheet_import_runs.sql` | Spreadsheet previewの一回限りrun |
| Active | `migrations/0002_terms_reaccept_manual_cost_guard.sql` | 規約再同意索引/FKと手動CostGuardへの整理 |
| Active | `migrations/0003_large_collaboration_support.sql` | 大規模合作向け監査ペイロード上限引き上げ |
| Active | `migrations/0038_runtime_efficiency_resilience.sql` | Worker lease状態と頻出読取index |
| Active | `migrations/0039_search_relation_indexes.sql` | 公開検索・クリエイター・チャプター用index |
| Active | `migrations/0040_free_tier_background_jobs.sql` | 期限駆動同期・dirtyスコア・通知節約列/index |
| Active | [`db-change-history.md`](../db-change-history.md) | 現行DB変更履歴 |
| Planned | `docs/implementation-backlog.md` | 未着手またはブロック中の要求。実装済みと記載しない |
| Historical | `migrations/historical/` | 旧migration本文の保存。現行runtimeでは参照・適用しない |
| Historical | [`historical/README.md`](../historical/README.md) | 旧文書の位置づけ |

## 方針

DBはD1を正本とし、R2/KVの静的JSONはキャッシュとする。現行コードに起動時の自動スキーマ適用、旧列fallback、二重書き込みを残さない。Cloudflare Pages + `@cloudflare/next-on-pages` と、`background-jobs` 1 Worker内の5分・1時間Cronを正本とする。

旧migrationは内容を改変・削除せずHistoricalとして保存する。履歴資料の記述は当時の記録であり、現行仕様の根拠にはしない。
