# FlameNode 運用

> Status: Active
> Last verified: 2026-07-13
> Verified against commit: `fcdf468`
> Source of truth: `src/lib/db/schema.ts`, `migrations/` active path, `wrangler.toml`, `workers/background-jobs/wrangler.toml`, `package.json`

FlameNodeは Cloudflare Pages + `@cloudflare/next-on-pages`、D1、R2、KV、`background-jobs` 1 Worker内の5分・1時間Cronで運用する。実Cloudflareへのリソース作成・Remote D1 migration・deployは運用者だけが明示的に実行し、CodexやPR CIは実行しない。

## 正本と不変条件

- DB正本は `src/lib/db/schema.ts`。active migrationは `migrations/` 直下を番号順に適用する。
- 旧migration本文は `migrations/historical/` に保存する。旧列・runtime fallback・二重書込みは提供しない。
- 内部ユーザーIDは `user_id`、Discord Snowflakeは `discord_id`。`event_staff.permission_preset = 'owner'` がイベント代表者の正本で、`role`は表示ミラーだけである。
- 重要な書込みはD1 batchで本体mutationと監査ログを確定する。ownerの削除・降格・自己変更は専用の確認付き経路を通す。

## 運用入口

| 領域 | Active文書 |
| --- | --- |
| baseline / local D1 / Remote手動手順 | [migrations.md](migrations.md) |
| 統合Cron Workerと上限 | [workers.md](workers.md) |
| 監査・復元・owner保護 | [audit-and-restore.md](audit-and-restore.md) |
| legacy data import | [legacy-import.md](legacy-import.md) |
| Spreadsheet import | [spreadsheet-import.md](spreadsheet-import.md) |
| R2静的JSONと公開DTO | [static-delivery.md](static-delivery.md) |
| fail-closed時の一次対応 | [incident-response.md](incident-response.md) |
| X ID統合 | [x-id-merge.md](x-id-merge.md) |

## 文書とDB履歴

- 現行のDB運用: [migrations.md](migrations.md)
- migrationテンプレート: [../templates/migration.md](../templates/migration.md)
- DB履歴索引: [../db-history/README.md](../db-history/README.md)
- DB変更履歴の正本: [../database/change-log.md](../database/change-log.md)
- Historical資料: [../historical/README.md](../historical/README.md)
