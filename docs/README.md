# FlameNode ドキュメント索引

> Status: Active
> Last verified: 2026-07-11
> Verified against commit: `5f48e0f` + working tree
> Source of truth: `src/lib/db/schema.ts`, `migrations/0000_flame_node_baseline.sql`, `wrangler.toml`, `package.json`

現行実装はコード、DB schema、active migration、Cloudflare設定、Active文書の順に確認します。Historical文書は経緯の保存だけを目的とし、現行実装の根拠には使用しません。

| 区分 | 文書 | 責務 |
| --- | --- | --- |
| Active | [operations/README.md](operations/README.md) | 運用全体の入口と所有文書 |
| Active | [operations/migrations.md](operations/migrations.md) | baseline、ローカル適用、Remote D1の手動手順 |
| Active | [operations/workers.md](operations/workers.md) | 3本のCron Worker、lease、上限、障害対応 |
| Active | [operations/audit-and-restore.md](operations/audit-and-restore.md) | 監査、復元、owner不変条件 |
| Active | [operations/legacy-import.md](operations/legacy-import.md) | legacy importのpreview/apply安全手順 |
| Active | [operations/static-delivery.md](operations/static-delivery.md) | R2静的JSONと公開範囲 |
| Active | [operations/incident-response.md](operations/incident-response.md) | fail-closed時の一次対応 |
| Historical | [database/README.md](database/README.md) | 旧DB文書。現行入口は `db-history/` と `operations/migrations.md` |
| Historical | [database/change-log.md](database/change-log.md) | 旧DB変更履歴。現行履歴は `db-change-history.md` |
| Active | [db-history/README.md](db-history/README.md) | Active / Planned / Historical とbaseline履歴の索引 |
| Active | [db-change-history.md](db-change-history.md) | 現行DB変更履歴の正本 |
| Active | [templates/migration.md](templates/migration.md) | active migrationの記録テンプレート |
| Planned | [implementation-backlog.md](implementation-backlog.md) | 未着手・ブロック中の要求のみ |
| Historical | [operations.md](operations.md) | pre-baseline前の運用手順 |
| Historical | [merge-flow-design.md](merge-flow-design.md) | pre-baseline前のX ID統合設計メモ |
| Historical | `migrations/historical/` | pre-production前の旧migration本文 |

実装変更時は、該当するActive文書だけを同じ変更へ更新します。schemaの列一覧やWorker実装の複製を別文書へ作らず、正本へリンクしてください。`docs/operations.md` と `docs/database/**` の旧記述はHistorical/旧入口として扱い、現行手順には使用しません。
