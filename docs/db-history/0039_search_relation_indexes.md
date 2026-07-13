# 0039 Search Relation Indexes

> Status: Active
> Last verified: 2026-07-13
> Verified against commit: `684bc10`
> Source of truth: `migrations/0039_search_relation_indexes.sql`, `src/lib/db/schema.ts`

対象migration: `0039_search_relation_indexes.sql`

## 目的

公開作品検索、トップ用クリエイター集計、公開チャプター検索で既存の検索結果を変えず、相関サブクエリが対象行を見つけるまでの走査量を削減する。

## 変更内容

- `videos(creator_x_user_id, visibility_status, primary_event_id, id)`を追加する。
- `video_members(x_user_id, video_id)`を追加する。
- `video_chapters(video_id, visibility)`を追加する。
- テーブル、列、データ、検索条件は変更しない。

## データ損失

なし。追加するのはindexのみで、既存行を書き換えない。

## ロールバック

以下を個別に削除する。

```sql
DROP INDEX IF EXISTS videos_creator_public_idx;
DROP INDEX IF EXISTS video_members_x_user_video_idx;
DROP INDEX IF EXISTS video_chapters_video_visibility_idx;
```

## 検証

- 空DBへbaselineからactive migrationを順番に適用する。
- `npm run check:db-schema`
- `npm run check:db-history`
- `npm run typecheck`
- `npm run test:unit`
- 公開作品検索とイベント絞り込みの件数・順序がmigration前後で一致することを確認する。
