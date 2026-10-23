# 0065_public_build_state.sql

> Status: Active
> Migration: 0065_public_build_state.sql
> Date: 2026-10-17
> Type: additive
> Data loss: none
> Rollback: `DROP TABLE IF EXISTS public_build_state`
> Change log: docs/database/change-log.d/0065_public_build_state.md
> Source of truth: `migrations/0065_public_build_state.sql`, `src/lib/db/schema.ts`

## 目的 (Purpose)

公開データが更新された際に、Cloudflare Workers Builds のデプロイフック（`POST /deploy-hook`）を有界な頻度で安全に呼び出すための状態管理テーブル（`public_build_state`）を定義する（MIG-0410、D-09）。

## 変更内容 (Changes)

- `public_build_state` テーブルを追加（単一行 `id = 1` 制約）。
- `requested_at`（公開データ最終変更時刻）、`last_hook_at`（最終デプロイフック呼出時刻）、`hooks_day`（呼出回数を追跡するUTC日）、`hooks_today`（当日呼出累計回数）を保持。
- 初期行 `INSERT INTO public_build_state (id) VALUES (1);` を投入。

## データ損失 (Data loss)

なし。新規独立テーブルの追加のみ。

## ロールバック (Rollback)

`DROP TABLE IF EXISTS public_build_state`。既存機能への影響なし。

## 検証 (Validation)

- `npm run check:db-schema`
- `npm run check:db-history`
- `node --test --experimental-strip-types workers/fast-jobs/publicBuildTrigger.test.mjs`
