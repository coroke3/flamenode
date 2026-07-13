# Migration Template

> Status: Active
> Last verified: 2026-07-13
> Verified against commit: `d0d7fd0`
> Source of truth: `docs/templates/migration.md`

現行のtemplateは [`../templates/migration.md`](../templates/migration.md) を使用する。このファイルは既存リンクを壊さないための入口として保持する。

```sql
-- Migration: 00NN_descriptive_name.sql
-- Date: YYYY-MM-DD
-- Type: additive | destructive | data-migration | constraint | cleanup | baseline
-- Summary: 変更内容
-- Data loss: none | possible | intentional
-- Rollback: reversible | manual | not safely reversible、または具体的な復旧方法
-- Change log: docs/database/change-log.md
```

schema、migration、`docs/database/change-log.md`、運用文書、検査を同一変更で更新する。既適用migrationのSQL本文は変更しない。
