# `0000_flame_node_baseline.sql`

> Status: Active
> Date: 2026-07-11
> Type: baseline
> Source of truth: `src/lib/db/schema.ts`

## 変更概要

最終canonical schemaを空のD1へ一括作成するpre-production baseline。適用対象は `migrations/0000_flame_node_baseline.sql` で、旧migrationは `migrations/historical/` に保持する。

## 境界

- Data loss: intentional。Remote D1や本番データを自動初期化しない。
- Compatibility: 旧列・旧tableのruntime互換、旧方式へのfallback、二重書き込みは提供しない。
- Rollback: not safely reversible。必要時は運用者が事前backupから復旧する。
- D1が正本で、R2/KV静的JSONは配信用キャッシュである。

## 検査

```sh
npm.cmd run check:db-schema
npm.cmd run check:db-history
```

## Legacy import staging

`legacy_import_batches` persists `canonical_plan_json` / `preview_expires_at` for the reviewed plan and `lease_token` / `lease_expires_at` / `consumed_at` for one-time apply. These columns belong to the pre-production baseline only; this repository never changes Remote D1 automatically.
