# 0045_align_visibility_defaults.sql

> Status: Active  
> Date: 2026-07-31  
> Type: cleanup  
> Source of truth: `migrations/0045_align_visibility_defaults.sql`, `src/lib/db/schema.canonical.ts`

## 目的

`events.visibility_status` と `videos.visibility_status` の物理 default を Drizzle 正本（`private` / `pending`）へ揃え、`0044` で導入した INSERT 直後正規化 trigger を削除する。

## 変更内容

- `events` / `videos` を再作成し、物理 default を更新
- `events_visibility_status_canonical_insert` / `videos_visibility_status_canonical_insert` を削除
- `reject_insert` trigger から `draft` を除外
- `canonical_update` trigger は維持

## データ損失

なし。既存行の `visibility_status` はコピーのみ。

## ロールバック

適用前 D1 バックアップを復元する。

## 検証

- `npm run check:db-schema`
- `npm run check:db-history`
- `src/lib/integration/statusModel.integration.test.mjs`
