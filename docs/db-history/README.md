# DB履歴

> Status: Active
> Last verified: 2026-07-13
> Verified against commit: `28bd38d74a991ac9a06070a330e038c5d03ffa03`
> Source of truth: `src/lib/db/schema.ts`, `migrations/` active path

## 区分

| 区分 | 対象 | 扱い |
| --- | --- | --- |
| Active | `migrations/0000_flame_node_baseline.sql` | 空D1へ最初に適用する現行baseline |
| Active | `migrations/0001_spreadsheet_import_runs.sql` | Spreadsheet previewの一回限りrun |
| Active | `migrations/0002_terms_reaccept_manual_cost_guard.sql` | 規約再同意索引/FKと手動CostGuardへの整理 |
| Active | `migrations/0003_large_collaboration_support.sql` | 大規模合作向け監査ペイロード上限引き上げ |
| Active | `migrations/0038_runtime_efficiency_resilience.sql` | Worker状態列と頻出読取用index |
| Active | `migrations/0039_search_relation_indexes.sql` | 公開検索・creator集計・chapter検索用index |
| Active | `migrations/0040_worker_free_tier_scale.sql` | スコア差分更新の無料枠向けindex |
| Active | `migrations/0042_event_youtube_playlist_sync.sql` | イベント別YouTube再生リスト差分同期 |
| Active | [`database/change-log.md`](../database/change-log.md) | active migrationに対応する現行DB変更履歴 |
| Active | `docs/implementation-backlog.md` | Open、Blocked、Recently completedの現在状態 |
| Historical | `migrations/historical/` | 旧migration本文の保存。現行runtimeでは参照・適用しない |
| Historical | [`historical/README.md`](../historical/README.md) | 旧文書の位置づけ |

## 方針

DBはD1を正本とし、R2/KVの静的JSONはキャッシュとする。現行コードに起動時の自動スキーマ適用、旧列fallback、二重書き込みを残さない。Cloudflare Pages + `@cloudflare/next-on-pages` と、`fast-jobs`、`content-jobs`、`sync-jobs` の3 Cron Worker構成は変更しない。

旧migrationは内容を改変・削除せずHistoricalとして保存する。履歴資料の記述は当時の記録であり、現行仕様の根拠にはしない。
