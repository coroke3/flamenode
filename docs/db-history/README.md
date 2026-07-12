# DB履歴

> Status: Active
> Last verified: 2026-07-12
> Source of truth: `src/lib/db/schema.ts`, `migrations/0000_flame_node_baseline.sql`

## 区分

| 区分 | 対象 | 扱い |
| --- | --- | --- |
| Active | `migrations/0000_flame_node_baseline.sql` | 空D1へ適用する現行baseline |
| Active | [`db-change-history.md`](../db-change-history.md) | 現行DB変更履歴 |
| Planned | `docs/implementation-backlog.md` | 未着手またはブロック中の要求。実装済みと記載しない |
| Historical | `migrations/historical/` | 旧migration本文の保存。現行runtimeでは参照・適用しない |
| Historical | [`historical/README.md`](../historical/README.md) | 旧文書の位置づけ |

## 方針

DBはD1を正本とし、R2/KVの静的JSONはキャッシュとする。現行コードに起動時の自動スキーマ適用、旧列fallback、二重書き込みを残さない。Cloudflare Pages + `@cloudflare/next-on-pages` と、`fast-jobs`、`content-jobs`、`sync-jobs` の3 Cron Worker構成は変更しない。

旧migrationは内容を改変・削除せずHistoricalとして保存する。履歴資料の記述は当時の記録であり、現行仕様の根拠にはしない。
