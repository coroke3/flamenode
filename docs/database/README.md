# Database 運用

> Status: Active
> Last verified: 2026-07-13
> Verified against commit: `7198dc9`
> Source of truth: `src/lib/db/schema.ts`, `migrations/` active path, `docs/database/change-log.md`

`src/lib/db/schema.ts` がDB構造の唯一の正本です。active migrationは `migrations/` 直下を番号順に適用し、空のD1にはbaseline後に後続migrationを適用します。以前のmigration本文は改変せず `migrations/historical/` に保存します。

DB変更履歴の唯一の正本は [`change-log.md`](change-log.md) です。migrationごとの詳細記録は [`../db-history/README.md`](../db-history/README.md) から参照します。旧 [`../db-change-history.md`](../db-change-history.md) には追記しません。

- applied migrationを変更しない。schema変更は新しい連番migrationとして追加する。
- 自動生成を前提にしない。手動SQL、schema、変更履歴、詳細記録を同じ変更で更新する。
- 破壊的変更、Remote D1適用、実データ修復は運用者の明示操作だけで行う。
- `audit_logs` はデータ編集履歴、migrationはschema履歴であり、用途を混同しない。
- rollbackを安全に自動化できない変更は、復旧手順と検証をchange logへ記載する。

現行のmigration templateは [`../templates/migration.md`](../templates/migration.md) を使用します。
