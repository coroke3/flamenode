# FlameNode 運用

> Status: Active
> Last verified: 2026-07-20
> Verified against commit: `8de170c`
> Source of truth: `src/lib/db/schema.ts`, `migrations/`, `wrangler.toml`, `package.json`

Cloudflare Pages + `@cloudflare/next-on-pages`、D1、R2、KV、Cron Worker 3本で運用する。実Cloudflare操作、Remote D1、production secret操作は運用者が明示した場合だけ行う。

## AI読取ルール

下表から該当文書1件だけを選び、次に対象コードとtestを読む。運用文書を一括読込しない。

## 不変条件

- DB正本は`src/lib/db/schema.ts`。active migrationは`migrations/`直下を番号順に適用する。
- 旧migration本文は`migrations/historical/`へ保存し、旧列fallback、旧形式パーサー、runtime DDL、二重書込みを提供しない。
- 本格運用前のデータ変更は正本へ一括移行し、常設の後方互換機能を追加しない。
- 内部ユーザーIDは`user_id`、Discord Snowflakeは`discord_id`。
- `event_staff.permission_preset = 'owner'`がイベント代表者の正本で、ownerを0人にしない。
- 重要mutationと監査ログは同じ原子的処理で確定する。

## タスク別入口

| タスク | Active文書 |
| --- | --- |
| baseline / local D1 / Remote手動手順 | [migrations.md](migrations.md) |
| DB正本移行・旧データ変換 | [../database/canonical-migration-plan.md](../database/canonical-migration-plan.md) |
| Cron Worker、lease、上限 | [workers.md](workers.md) |
| YouTube再生リスト同期 | [youtube-playlist-sync.md](youtube-playlist-sync.md) |
| 監査・復元・owner保護 | [audit-and-restore.md](audit-and-restore.md) |
| spreadsheet import | [spreadsheet-import.md](spreadsheet-import.md) |
| 旧JSON・CSV・TSVの一方向変換 | [legacy-import.md](legacy-import.md) |
| R2静的JSON、公開DTO | [static-delivery.md](static-delivery.md) |
| 障害の一次対応 | [incident-response.md](incident-response.md) |
| X ID統合 | [x-id-merge.md](x-id-merge.md) |
| UI受入基準 | [ui-acceptance.md](ui-acceptance.md) |
| 外部API上限 | [external-api-limits.md](external-api-limits.md) |

## DB履歴

- 現行DB運用: [migrations.md](migrations.md)
- migrationテンプレート: [../templates/migration.md](../templates/migration.md)
- 詳細履歴索引: [../db-history/README.md](../db-history/README.md)
- DB変更履歴の正本: [../database/change-log.md](../database/change-log.md)
- Historical資料: [../historical/README.md](../historical/README.md)
