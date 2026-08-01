# 0046_video_creator_profile_snapshot.sql

> Status: Active  
> Date: 2026-08-01  
> Type: additive  
> Source of truth: `migrations/0046_video_creator_profile_snapshot.sql`, `src/lib/db/schema.canonical.ts`

## 目的

作品の提出者プロフィールを `x_users` の現在値から分離し、提出・編集時点の値を作品ごとのスナップショットとして保持する。

## 変更内容

- `videos.creator_profile_text` と `videos.creator_other_social_links` を追加
- 既存作品の追加列を、migration 実行時点の `x_users` から補完
- 既存の `creator_youtube_channel_url` と `creator_icon_url` が空の場合も同じ時点の値で補完
- migration 後の作品保存では `x_users` を更新せず、作品側の値だけを保存

## データ損失

なし。過去の提出時点の値は復元できないため、既存作品については migration 実行時点のプロフィールを初期スナップショットにする。

## ロールバック

適用前の D1 バックアップから復元する。

## 検証

- `npm run check:db-schema`
- `npm run check:db-migration`
- `npm run check:db-history`
- `src/lib/video/submitterSnapshot.independence.integration.test.mjs`
- `src/lib/video/submitterSnapshot.contract.test.mjs`
