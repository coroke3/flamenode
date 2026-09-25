# 0062_static_artifact_cleanup_index.sql

> Status: Active
> Migration: 0062_static_artifact_cleanup_index.sql
> Date: 2026-09-25
> Type: additive
> Data loss: none
> Rollback: `DROP INDEX IF EXISTS static_artifacts_live_cleanup_idx`
> Change log: docs/database/change-log.d/0062_static_artifact_cleanup_index.md
> Source of truth: `migrations/0062_static_artifact_cleanup_index.sql`, `src/lib/db/schema.ts`

## 目的 (Purpose)

boundedなlive static artifact cleanupで、target条件による絞り込みと `generated_at ASC` の走査をindexで処理する。

## 変更内容 (Changes)

- Add the partial index `static_artifacts_live_cleanup_idx` on `(target_type, target_id, generated_at, object_key)` where `deleted_at IS NULL`.
- このindexはcleanup候補の並び順とobject key取得をcoverする。artifactの形、cleanup対象、R2削除順序は変更しない。

## データ損失 (Data loss)

なし。既存行を書き換えず、indexのみ追加する。

## ロールバック (Rollback)

`DROP INDEX IF EXISTS static_artifacts_live_cleanup_idx` で追加indexを削除する。アプリケーションのcleanup SQL最適化を同時に戻す場合を除き、通常のrollback操作は不要。

## 検証 (Validation)

- `npm run check:db-schema`
- `npm run check:db-history`
- SQLite `EXPLAIN QUERY PLAN` でcleanup indexの利用と相関subqueryの消失を確認
- `workers/json-generator/rebuild.test.mjs` およびusers-index-v2 artifact execution tests
