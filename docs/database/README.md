# Database 運用

> Status: Active
> Last verified: 2026-07-11
> Verified against commit: `5f48e0f` + working tree
> Source of truth: `src/lib/db/schema.ts`, `migrations/0000_flame_node_baseline.sql`

`src/lib/db/schema.ts` がDBの唯一の正本です。active migrationは `migrations/0000_flame_node_baseline.sql` だけで、空のD1に最終schemaを作成します。以前のmigration本文は改変せず `migrations/historical/` に保存しています。

- applied migrationを変更しない。schema変更は新しいbaselineを作る前に、pre-productionであることとRemote D1を自動変更しないことを確認する。
- `npm run db:generate` は使わない。手動SQLとschema、[change log](change-log.md)を同じ変更で更新する。
- 破壊的変更、Remote D1適用、実データの修復は運用者の明示操作だけで行う。
- `audit_logs` はデータ編集履歴、migrationはschema履歴であり、用途を混同しない。
- rollbackが安全に自動化できない変更は、復旧手順と検証をchange logへ記載する。

雛形は [migration-template.md](migration-template.md)、設計判断の記録先は [decisions/README.md](decisions/README.md) です。
