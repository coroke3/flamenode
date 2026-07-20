# FlameNode ドキュメント索引

> Status: Active
> Last verified: 2026-07-20
> Verified against commit: `8de170c`
> Source of truth: `src/lib/db/schema.ts`, `migrations/`, `wrangler.toml`, `package.json`

## AIの読取順

1. [`../AGENTS.md`](../AGENTS.md)
2. [`AI_CONTEXT.md`](AI_CONTEXT.md)の該当タスク行
3. 対象コードと関連test
4. 必要なActive文書1件

Historical、archive、旧監査資料は現行仕様の根拠にしない。長い文書は該当見出しだけを読む。

## 現行構成

Cloudflare Pages + `@cloudflare/next-on-pages`、D1、R2、KV、Cron Worker 3本を使用する。正確な状態はコード、schema、active migration、Cloudflare設定を優先する。

## Active文書

| 目的 | 文書 |
| --- | --- |
| AI作業判断 | [AI_CONTEXT.md](AI_CONTEXT.md) |
| 運用入口 | [operations/README.md](operations/README.md) |
| DB運用入口 | [database/README.md](database/README.md) |
| DB正本移行仕様 | [database/canonical-migration-plan.md](database/canonical-migration-plan.md) |
| DB変更履歴の正本 | [database/change-log.md](database/change-log.md) |
| migration詳細索引 | [db-history/README.md](db-history/README.md) |
| 未完了事項 | [implementation-backlog.md](implementation-backlog.md) |
| ローカル起動 | [../LOCAL.md](../LOCAL.md) |
| デプロイ | [../DEPLOY.md](../DEPLOY.md) |

## 運用文書

| タスク | 文書 |
| --- | --- |
| migration | [operations/migrations.md](operations/migrations.md) |
| Cron Worker | [operations/workers.md](operations/workers.md) |
| YouTube同期 | [operations/youtube-playlist-sync.md](operations/youtube-playlist-sync.md) |
| 監査・復元・owner保護 | [operations/audit-and-restore.md](operations/audit-and-restore.md) |
| spreadsheet import | [operations/spreadsheet-import.md](operations/spreadsheet-import.md) |
| R2静的配信 | [operations/static-delivery.md](operations/static-delivery.md) |
| 障害対応 | [operations/incident-response.md](operations/incident-response.md) |
| UI受入基準 | [operations/ui-acceptance.md](operations/ui-acceptance.md) |
| 外部API上限 | [operations/external-api-limits.md](operations/external-api-limits.md) |

旧形式入力は管理者専用インポート境界でのみ受理し、新正本へ一方向変換する。通常ランタイムでは旧形式を扱わない。

## Historical

- [historical/README.md](historical/README.md): 過去資料の入口
- [db-change-history.md](db-change-history.md): 旧DB変更履歴
- [operations.md](operations.md): pre-baseline運用手順
- [merge-flow-design.md](merge-flow-design.md): 旧X ID統合設計
- `.claude/flamenode/`: 完了済み修正キャンペーン資料

実装変更時は該当Active文書だけを更新する。schema列一覧、実装コード、設定値をMarkdownへ複製せず、正本へリンクする。
