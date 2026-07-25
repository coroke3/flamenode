# FlameNode ドキュメント索引

> Status: Active
> Last verified: 2026-07-25
> Verified against commit: `dc46eefa`
> Source of truth: `AGENTS.md`, `src/lib/db/schema.ts`, `migrations/`, `wrangler.toml`, `package.json`

## AIの読取順

[`../AGENTS.md`](../AGENTS.md) → [`AI_CONTEXT.md`](AI_CONTEXT.md) の該当行 → 対象コード/test。運用の次の1件は [`operations/README.md`](operations/README.md)。

Historical / archive / 完了済み phase は現行仕様の根拠にしない。

現行構成の要約: Cloudflare Workers + OpenNext + Workers Static Assets。詳細はルート `README.md`。

## Active入口

| 目的 | 文書 |
| --- | --- |
| AI作業判断 | [AI_CONTEXT.md](AI_CONTEXT.md) |
| 運用タスク表 | [operations/README.md](operations/README.md) |
| DB運用 | [database/README.md](database/README.md) |
| DB変更履歴 | [database/change-log.md](database/change-log.md) |
| 未完了 | [implementation-backlog.md](implementation-backlog.md) |
| ローカル | [../LOCAL.md](../LOCAL.md) |
| デプロイ | [../DEPLOY.md](../DEPLOY.md) |

旧形式の一方向取込は [operations/legacy-import.md](operations/legacy-import.md)（管理者専用）。通常ランタイム・公開API・Workerへ広げない。

## Historical（必要時のみ）

- [historical/README.md](historical/README.md)
- [db-history/README.md](db-history/README.md)（migration 詳細索引）
- `.claude/flamenode/`（完了済みキャンペーン）

実装変更時は該当 Active だけ更新する。schema 列・実装・設定値を Markdown へ複製しない。
