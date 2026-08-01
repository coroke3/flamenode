# 0047_backfill_youtube_metadata_pending.sql

> Status: Active  
> Date: 2026-08-01  
> Type: data-migration  
> Source of truth: `migrations/0047_backfill_youtube_metadata_pending.sql`, `src/lib/db/schema.canonical.ts`

## 目的

YouTube ID を持ちながら同期メタデータがない既存作品を再同期対象へ戻し、公開可否を確認できないまま「懐かしの映像」候補から漏れ続ける状態を解消する。

## 変更内容

- 非 `voided` かつ YouTube ID が空でない作品を対象にする
- `video_youtube_metadata` が存在しない作品だけ `pending` 行を追加する
- 既存の同期結果・視聴数・公開可否は更新しない
- `INSERT OR IGNORE` により再適用時も重複行を作らない

## データ損失

なし。既存メタデータ行は変更せず、欠損行だけを追加する。

## ロールバック

適用前バックアップとの差分を確認し、この migration が追加した未同期の `pending` 行だけを削除する。同期済み行へ進んだ後はバックアップから復元する。

## 検証

- `npm run check:db-schema`
- `npm run check:db-migration`
- `npm run check:db-history`
- `src/lib/integration/youtubeMetadataBackfill.integration.test.mjs`
- `workers/json-generator/rebuild.test.mjs`

