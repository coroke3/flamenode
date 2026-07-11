# Migration 運用

> Status: Active
> Last verified: 2026-07-11
> Verified against commit: `5f48e0f` + working tree
> Source of truth: `src/lib/db/schema.ts`, `migrations/0000_flame_node_baseline.sql`

ローカルの空D1には `npm run db:local-apply` を実行する。開発サーバーはmigration、ALTER、backfillを実行しない。schema versionが一致しない場合はfail-fastで停止する。

Remote D1の作成、backup、migration適用、rollbackは運用者がCloudflareの手順に従い明示的に行う。CIとCodexはRemote D1を変更しない。
