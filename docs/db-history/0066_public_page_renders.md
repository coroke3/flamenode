# 0066_public_page_renders.sql

> Status: Active
> Migration: 0066_public_page_renders.sql
> Date: 2026-10-18
> Type: additive
> Data loss: none
> Rollback: `DROP TABLE IF EXISTS public_page_renders`
> Change log: docs/database/change-log.d/0066_public_page_renders.md
> Source of truth: `migrations/0066_public_page_renders.sql`, `src/lib/db/schema.ts`

## 目的 (Purpose)

個別ページ（作品・ユーザー・イベント）のQueue駆動R2事前生成（ISR相当）要求を管理する状態管理テーブル（`public_page_renders`）を定義する（MIG-0411、D-06、D-09）。

## 変更内容 (Changes)

- `public_page_renders` テーブルを追加。
- 複合主キー `(entity, entity_id)` を持ち、`entity`（'video', 'user', 'event'）、`entity_id`、`requested_at`（更新要求時刻）、`rendered_at`（R2生成完了時刻）を管理。
- 更新APIは同一トランザクション内で `INSERT ... ON CONFLICT DO UPDATE SET requested_at = excluded.requested_at` を発行する。

## データ損失 (Data loss)

なし。新規独立テーブルの追加のみ。

## ロールバック (Rollback)

`DROP TABLE IF EXISTS public_page_renders`。既存機能への影響なし。

## 検証 (Validation)

- `npm run check:db-schema`
- `npm run check:db-history`
- `node --test --experimental-strip-types apps/site/src/gateway/pageRenderQueue.test.mjs`
