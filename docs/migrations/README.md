# Migration文書

> Status: Active
> Last verified: 2026-07-12
> Source of truth: `src/lib/db/schema.ts`, `migrations/0000_flame_node_baseline.sql`

現行のmigration運用は [`operations/migrations.md`](../operations/migrations.md) に集約する。新規migrationの記録形式は [`templates/migration.md`](../templates/migration.md)、DB変更履歴は [`db-change-history.md`](../db-change-history.md) を参照する。

active pathとHistorical pathを混在させない。`migrations/historical/` のSQL本文は履歴として保存するだけで、runtime migration、旧列fallback、二重書き込みの実装や運用手順として扱わない。
