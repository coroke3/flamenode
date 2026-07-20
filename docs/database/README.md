# Database 運用

> Status: Active  
> Last verified: 2026-07-20  
> Verified against commit: `e5411d6`  
> Source of truth: `src/lib/db/schema.ts`, `migrations/` active path, `docs/database/change-log.md`

`src/lib/db/schema.ts` がアプリケーションから参照するDB構造の唯一の公開入口です。DB正本移行の仕様判断は [`canonical-migration-plan.md`](canonical-migration-plan.md)、正確なcanonical定義は `src/lib/db/schema.canonical.ts`、適用手順は `migrations/0043_db_canonical_migration.sql` を参照します。

active migrationは `migrations/` 直下を番号順に適用し、空のD1にはbaseline後に後続migrationを適用します。以前のmigration本文は改変せず `migrations/historical/` に保存します。

DB変更履歴の正本は [`change-log.md`](change-log.md) です。migrationごとの詳細記録は [`../db-history/README.md`](../db-history/README.md) から参照します。旧 [`../db-change-history.md`](../db-change-history.md) には追記しません。

## 運用原則

- applied migrationのSQL本文を変更しない。schema変更は新しい連番migrationとして追加する。
- 手動SQL、Drizzle schema、変更履歴、詳細記録、検証スクリプトを同じ変更で更新する。
- migration種別は `additive | destructive | data-migration | constraint | cleanup | baseline` に統一する。
- 破壊的変更、Remote D1適用、実データ修復は運用者の明示操作だけで行う。
- 破壊的migrationは、事前検査、バックアップ、件数照合、復元手順を必須とする。
- `audit_logs` はデータ編集履歴、migrationはschema履歴であり、用途を混同しない。
- 文書の「完了」記述だけを根拠にせず、CIと実DB検証結果で完了判定する。

現行のmigration templateは [`../templates/migration.md`](../templates/migration.md) を使用します。
