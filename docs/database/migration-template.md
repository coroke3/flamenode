# Migration Template

> Status: Active
> Last verified: 2026-07-11
> Verified against commit: `5f48e0f` + working tree
> Source of truth: `docs/templates/migration.md`

現行のtemplateは [`../templates/migration.md`](../templates/migration.md) を使用する。このファイルは旧入口として保持する。

```sql
-- Migration: 00NN_descriptive_name.sql
-- Date: YYYY-MM-DD
-- Type: additive | destructive | data-migration | constraint | cleanup | baseline
-- Summary: 変更内容
-- Data loss: none | possible | intentional
-- Rollback: reversible | manual | not safely reversible
-- Change log: docs/db-change-history.md
```

schema、migration、change log、運用文書、検査を同一変更で更新する。既適用SQL本文は変更しない。
