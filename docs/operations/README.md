# FlameNode 運用

> Status: Active
> Last verified: 2026-07-11
> Source of truth: `src/lib/db/schema.ts`, `migrations/0000_flame_node_baseline.sql`, `wrangler.toml`, `package.json`

FlameNodeは Cloudflare Pages + `@cloudflare/next-on-pages`、D1、R2、KV、3本のCron Workerで運用する。実Cloudflareへのリソース作成・Remote D1 migration・deployは運用者だけが明示的に実行し、CodexやPR CIは実行しない。

## 正本と不変条件

- DB正本は `src/lib/db/schema.ts`、空D1へのactive migrationは `migrations/0000_flame_node_baseline.sql`。
- 旧migration本文は `migrations/historical/` に保存する。旧列・runtime fallback・二重書込みは提供しない。
- 内部ユーザーIDは `user_id`、Discord Snowflakeは `discord_id`。`event_staff.permission_preset = 'owner'` がイベント代表者の正本で、`role`は表示ミラーだけである。
- 重要な書込みはD1 batchで本体mutationと監査ログを確定する。ownerの削除・降格・自己変更は専用の確認付き経路を通す。

## 運用入口

| 領域 | Active文書 |
| --- | --- |
| baseline / local D1 / Remote手動手順 | [migrations.md](migrations.md) |
| 3本のCron Workerと上限 | [workers.md](workers.md) |
| 監査・復元・owner保護 | [audit-and-restore.md](audit-and-restore.md) |
| legacy data import | [legacy-import.md](legacy-import.md) |
| R2静的JSONと公開DTO | [static-delivery.md](static-delivery.md) |
| fail-closed時の一次対応 | [incident-response.md](incident-response.md) |
| X ID統合 | [x-id-merge.md](x-id-merge.md) |

## 文書とDB履歴

- 現行のDB運用: [migrations.md](migrations.md)
- migrationテンプレート: [../templates/migration.md](../templates/migration.md)
- DB履歴索引: [../db-history/README.md](../db-history/README.md)
- DB変更履歴: [../db-change-history.md](../db-change-history.md)
- Historical資料: [../historical/README.md](../historical/README.md)

Active文書は現行実装の手順だけを扱う。旧migrationや過去の設計本文はHistoricalとして保存し、起動時の自動スキーマ適用、旧列fallback、二重書き込みの運用手順として再利用しない。

## 必須検査

ローカルで変更を統合する前に、少なくとも `npm run typecheck`、`npm run lint`、`npm run test:unit`、`npm run test:workers`、`npm run test:integration`、`npm run build`、`npm run pages:build`、`npm run check:pages-output`、`npm run check:cloudflare-template`、`npm run check:db-schema`、`npm run check:db-legacy`、`npm run check:event-owners`、`npm run check:docs`、`npm run check:db-history`、`npm run check:project-docs` を通す。

`check:cloudflare-config` は実SecretとIDを持たない環境ではfail-closedで失敗する。CIはfixture/template検査を使い、本番設定の成功を偽装しない。
