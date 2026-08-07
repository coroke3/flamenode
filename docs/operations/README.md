# FlameNode 運用

> Status: Active
> Last verified: 2026-07-25
> Verified against commit: `dc46eefa`
> Source of truth: `AGENTS.md`, `src/lib/db/schema.ts`, `migrations/`, `wrangler.toml`, `package.json`

Webは Cloudflare Workers + OpenNext + Workers Static Assets。背景は Queue wake（ドアベル）+ Recovery Cron 3本。production deploy 正本は Cloudflare Workers Builds のみ。

## AI読取

下表から **Active 文書1件** だけ選び、次に対象コードと test を読む。一括読込しない。  
規範・不変条件の正本は [`../../AGENTS.md`](../../AGENTS.md)。タスク導線は [`../AI_CONTEXT.md`](../AI_CONTEXT.md)。

軽量モデルは次で実装を止める: DB schema/migration、権限緩和、Cloudflare 実操作、Remote D1、production secret、破壊的変更。

## 運用固有の注意

- active migration は `migrations/` 直下を番号順。旧本文は `migrations/historical/`。
- 旧 JSON/CSV/TSV は [legacy-import.md](legacy-import.md) 境界のみ。通常ランタイムへ持ち込まない。
- 内部ユーザーIDは `user_id`、Discord Snowflake は `discord_id`。
- 重要 mutation と監査ログは同じ原子的処理で確定する。
- deploy 順は Web→fast→content→sync→smoke。Remote D1 は read-only preflight、migration 自動適用なし。
- **CostGuard と runtime safety**: Cloudflare 使用量では `operation_mode` を自動変更しない。機能制限（`economy` / `read_only` / `static_only` / `maintenance`、停止機能リスト）は `/admin/cost-guard` の手動操作のみ。D1 statement 上限、YouTube 日次 quota、Discord 429 バックオフ、ExternalRequestBudget、Queue batch 上限は invocation 安全装置であり CostGuard ではない。詳細は [`../../設計/FlameNode-Cloudflare-Free-Tier-Guardrails.md`](../../設計/FlameNode-Cloudflare-Free-Tier-Guardrails.md) §4-0。

## タスク別入口

| タスク | Active文書 |
| --- | --- |
| 初回デプロイ準備 | [deploy-setup-report.md](deploy-setup-report.md) |
| baseline / local D1 / Remote手動 | [migrations.md](migrations.md) |
| DB正本移行 | [../database/canonical-migration-plan.md](../database/canonical-migration-plan.md) |
| Worker・Queue・Cron | [workers.md](workers.md) |
| YouTube再生リスト同期 | [youtube-playlist-sync.md](youtube-playlist-sync.md) |
| 監査・復元・owner | [audit-and-restore.md](audit-and-restore.md) |
| spreadsheet import | [spreadsheet-import.md](spreadsheet-import.md) |
| 旧形式一方向取込 | [legacy-import.md](legacy-import.md) |
| R2静的・degraded | [static-delivery.md](static-delivery.md) |
| 障害一次対応 | [incident-response.md](incident-response.md) |
| X ID統合 | [x-id-merge.md](x-id-merge.md) |
| 認証・規約・post-commit | [auth-terms-postcommit-reliability.md](auth-terms-postcommit-reliability.md) |
| UI受入 | [ui-acceptance.md](ui-acceptance.md) |
| Google Analytics・急上昇 | [google-analytics.md](google-analytics.md) |
| 外部API上限 | [external-api-limits.md](external-api-limits.md) |

## DB履歴リンク

- 現行: [migrations.md](migrations.md)
- テンプレート: [../templates/migration.md](../templates/migration.md)
- 変更履歴正本: [../database/change-log.md](../database/change-log.md)
- 詳細索引: [../db-history/README.md](../db-history/README.md)
- Historical: [../historical/README.md](../historical/README.md)
