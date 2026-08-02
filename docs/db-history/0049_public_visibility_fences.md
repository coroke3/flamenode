# 0049_public_visibility_fences.sql

> Status: Active  
> Date: 2026-08-02  
> Type: additive  
> Source of truth: `migrations/0049_public_visibility_fences.sql`, `src/lib/db/schema.ts`

## 目的

公開配信の非公開化 fence を D1 で保持する `public_visibility_fences` テーブルを追加する。

## 変更内容

- `public_visibility_fences` テーブルを作成
- `state` / `updated_at` 用 index を追加

## データ損失

なし。新規テーブルのみ。

## ロールバック

適用前バックアップから復元する。

## 検証

- `npm run check:db-schema`
- `npm run check:db-migration`
- `npm run check:db-history`
- `npm run check:public-visibility-fences`
