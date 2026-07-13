# `0000_flame_node_baseline.sql`

> Status: Active
> Date: 2026-07-11
> Type: baseline
> Source of truth: `src/lib/db/schema.ts`

## 目的

最終canonical schemaを空のD1へ一括作成するpre-production baseline。適用対象は `migrations/0000_flame_node_baseline.sql` で、旧migrationは `migrations/historical/` に保持する。

## 変更内容

最終canonical schemaを空のD1へ一括作成する。旧migrationは `migrations/historical/` に保持し、現行runtimeのfallbackや二重書き込みには使用しない。

## データ損失

intentional。Remote D1や本番データを自動初期化しない。pre-production baselineとして空DBへ適用する前提。

## ロールバック

not safely reversible。必要時は運用者が事前backupから復旧する。

## 検証

```sh
npm.cmd run check:db-schema
npm.cmd run check:db-history
```

## Legacy import staging

`legacy_import_batches` persists `canonical_plan_json` / `preview_expires_at` for the reviewed plan and `lease_token` / `lease_expires_at` / `consumed_at` for one-time apply. These columns belong to the pre-production baseline only; this repository never changes Remote D1 automatically.
