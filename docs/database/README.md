# Database 運用

> Status: Active
> Last verified: 2026-07-13
> Verified against commit: `e772cc9`
> Source of truth: `src/lib/db/schema.ts`, `migrations/` active path

`src/lib/db/schema.ts` がDBの唯一の正本です。active migrationは `migrations/` 直下を番号順に適用し、空のD1にはbaseline後にadditive migrationを適用します。以前のmigration本文は改変せず `migrations/historical/` に保存しています。

- applied migrationを変更しない。schema変更は新しいbaselineを作る前に、pre-productionであることとRemote D1を自動変更しないことを確認する。
- 自動生成は使わない。手動SQLとschema、現行の [DB change history](../db-change-history.md) を同じ変更で更新する。
- 破壊的変更、Remote D1適用、実データの修復は運用者の明示操作だけで行う。
- `audit_logs` はデータ編集履歴、migrationはschema履歴であり、用途を混同しない。
- rollbackが安全に自動化できない変更は、復旧手順と検証をchange logへ記載する。

現行のmigration templateは [`../templates/migration.md`](../templates/migration.md)、DB変更履歴は [`../db-change-history.md`](../db-change-history.md) を使用する。このファイルは旧DB文書からの互換入口として保持する。
