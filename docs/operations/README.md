# FlameNode 運用

> Status: Active
> Last verified: 2026-07-21
> Verified against commit: `47e6cee`
> Source of truth: `src/lib/db/schema.ts`, `migrations/`, `wrangler.toml`, `package.json`

WebはCloudflare Workers + OpenNext + Workers Static Assets、背景処理はCron Worker 3本で運用する。本番デプロイ正本はCloudflare Workers Buildsだけとする。実Cloudflare操作、Remote D1、production secret操作は運用者が明示した場合だけ行う。

## AI読取ルール

下表から該当文書1件だけを選び、次に対象コードとtestを読む。運用文書を一括読込しない。

## 不変条件

- DB正本は`src/lib/db/schema.ts`。active migrationは`migrations/`直下を番号順に適用する。
- 旧migration本文は`migrations/historical/`へ保存し、旧列fallback、runtime DDL、二重書込みを提供しない。
- 旧JSON / CSV / TSVの解釈は管理者専用インポート境界へ隔離し、通常ランタイム、公開API、Workerへ持ち込まない。
- インポートはcanonical planを経由して新正本だけへ保存し、旧DB fallback、dual-read、dual-write、旧形式出力を提供しない。
- 内部ユーザーIDは`user_id`、Discord Snowflakeは`discord_id`。
- `event_staff.permission_preset = 'owner'`がイベント代表者の正本で、ownerを0人にしない。
- 重要mutationと監査ログは同じ原子的処理で確定する。
- production deployはWeb→fast→content→sync→smokeの固定順とし、commit SHA・binding・secret名・schemaの不一致をfail-closedにする。
- Remote D1はdeploy前にread-only検査する。migrationの自動適用は行わない。

## タスク別入口

| タスク | Active文書 |
| --- | --- |
| 初回デプロイ準備・設定チェック | [deploy-setup-report.md](deploy-setup-report.md) |
| baseline / local D1 / Remote手動手順 | [migrations.md](migrations.md) |
| DB正本移行・旧データ変換 | [../database/canonical-migration-plan.md](../database/canonical-migration-plan.md) |
| Cron Worker、lease、上限 | [workers.md](workers.md) |
| YouTube再生リスト同期 | [youtube-playlist-sync.md](youtube-playlist-sync.md) |
| 監査・復元・owner保護 | [audit-and-restore.md](audit-and-restore.md) |
| spreadsheet import | [spreadsheet-import.md](spreadsheet-import.md) |
| 旧JSON / CSV / TSVの一方向取込 | [legacy-import.md](legacy-import.md) |
| R2静的JSON、公開DTO | [static-delivery.md](static-delivery.md) |
| 障害の一次対応 | [incident-response.md](incident-response.md) |
| X ID統合 | [x-id-merge.md](x-id-merge.md) |
| 認証・規約同意・post-commit 信頼性 | [auth-terms-postcommit-reliability.md](auth-terms-postcommit-reliability.md) |
| UI受入基準 | [ui-acceptance.md](ui-acceptance.md) |
| 外部API上限 | [external-api-limits.md](external-api-limits.md) |

## DB履歴

- 現行DB運用: [migrations.md](migrations.md)
- migrationテンプレート: [../templates/migration.md](../templates/migration.md)
- 詳細履歴索引: [../db-history/README.md](../db-history/README.md)
- DB変更履歴の正本: [../database/change-log.md](../database/change-log.md)
- Historical資料: [../historical/README.md](../historical/README.md)
