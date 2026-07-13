# Historical資料

> Status: Historical
> Last verified: 2026-07-12

このディレクトリと `migrations/historical/` は、pre-production以前の設計・migration本文を履歴として保存する場所です。本文は消去・改変せず、現行実装の根拠やruntime互換の仕様として使用しません。

現行の正本は `src/lib/db/schema.ts` と `migrations/0000_flame_node_baseline.sql` です。現行運用は [`operations/migrations.md`](../operations/migrations.md) を参照してください。
