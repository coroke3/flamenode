# 0048_cleanup_video_visibility_indexes.sql

> Status: Active  
> Date: 2026-08-02  
> Type: cleanup  
> Source of truth: `migrations/0048_cleanup_video_visibility_indexes.sql`, `src/lib/db/schema.ts`

## 目的

公開静的ターゲット判定向けに、`visibility_status = 'public'` の動画 probe index を追加する。

## 変更内容

- `videos_public_id_probe_idx` を追加
- `videos_youtube_public_probe_idx` を追加（YouTube ID ありの public 行）

## データ損失

なし。index 追加のみ。

## ロールバック

適用前バックアップから復元する。

## 検証

- `npm run check:db-schema`
- `npm run check:db-migration`
- `npm run check:db-history`
