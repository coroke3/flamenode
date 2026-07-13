# Migration Template

> Status: Active
> Last verified: 2026-07-13
> Source of truth: `src/lib/db/schema.ts`, `migrations/` active path, `scripts/check-db-change-history.mjs`

active migrationを追加するときは、schema、SQL、DB変更履歴、migration詳細文書を同じ変更で更新します。既存migrationの本文は変更しません。

```sql
-- Migration: 00NN_descriptive_name.sql
-- Date: YYYY-MM-DD
-- Type: baseline | schema | data | index | constraint | security | cleanup
-- Summary: 変更内容
-- Data loss: none | possible | intentional
-- Rollback: 具体的な復旧方法。未定やTODOは禁止
-- Change log: docs/database/change-log.md

-- SQLはschema.tsの現行定義と一致させる。
```

## 必須確認

- `src/lib/db/schema.ts` が変更後の正本になっている。
- SQL本文に旧列fallback、旧table互換、二重書き込みを追加していない。
- `docs/database/change-log.md` にmigration名を1回だけ記載している。
- `docs/db-history/<migration名>.md` に目的、変更内容、データ損失、ロールバック、検証を記載している。
- Remote D1への適用は手順と承認を記録した運用者だけが行う。
- active migrationは既存SQL本文を変更せず、次の連番ファイルとして追加する。
- `npm run check:db-schema`、`npm run check:db-history`、`npm run check:project-docs` が成功する。
