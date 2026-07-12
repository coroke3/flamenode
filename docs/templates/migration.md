# Migration Template

> Status: Active
> Last verified: 2026-07-12
> Source of truth: `src/lib/db/schema.ts`, `migrations/0000_flame_node_baseline.sql`

active migrationを追加するときは、schema、SQL、DB変更履歴を同じ変更で更新する。既存migrationの本文は変更しない。

```sql
-- Migration: 00NN_descriptive_name.sql
-- Date: YYYY-MM-DD
-- Type: additive | destructive | data-migration | constraint | cleanup
-- Summary: 変更内容
-- Data loss: none | possible | intentional
-- Rollback: reversible | manual | not safely reversible
-- Change log: docs/db-change-history.md

-- SQLはschema.tsの現行定義と一致させる。
```

## 必須確認

- `src/lib/db/schema.ts` が変更後の正本になっている。
- SQL本文に旧列fallback、旧table互換、二重書き込みを追加していない。
- Remote D1への適用は手順と承認を記録した運用者だけが行う。
- `npm.cmd run check:db-schema`、`npm.cmd run check:db-history`、`npm.cmd run check:project-docs` が成功する。
