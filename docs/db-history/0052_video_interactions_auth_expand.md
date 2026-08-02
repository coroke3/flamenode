# 0052_video_interactions_auth_expand.sql

> Status: Active  
> Date: 2026-08-02  
> Type: additive  
> Source of truth: `migrations/0052_video_interactions_auth_expand.sql`, `src/lib/db/schema.ts`

## 目的

Auth user 単位のいいね・セーブ正本テーブルを追加し、owner が 1 人の既存行だけをバックフィルする。

## 変更内容

- `video_interactions_auth` テーブルを作成
- owner がちょうど 1 人の `video_interactions` 行を backfill
- 曖昧 owner 行は `_migration_0052_backfill_report` に記録
- 旧 `video_interactions` は維持

## データ損失

なし。旧 `video_interactions` は維持。

## ロールバック

適用前バックアップから復元する。report テーブル破棄後の曖昧行は手動確認が必要な場合がある。

## 検証

- `npm run check:db-schema`
- `npm run check:db-migration`
- `npm run check:db-history`
- `npm run check:video-interactions-auth`
