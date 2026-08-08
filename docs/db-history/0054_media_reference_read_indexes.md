# 0054_media_reference_read_indexes.sql

> Status: Active

- Date: 2026-08-08
- Type: additive
- Data loss: none

## 目的

D1 Query Insights で `public_media` の orphan/reference safety check が `x_users`、`videos`、`events`、`event_groups` を横断走査し、低頻度でも大きな `rows_read` を消費していたため、参照確認の意味論を変えず equality lookup を index 化する。

## 変更内容

次の nullable URL 列へ partial index を追加する。

- `x_users.icon_url`
- `videos.creator_icon_url`
- `events.icon_url`
- `events.img_url`
- `event_groups.icon_url`
- `event_groups.img_url`

各 index は `WHERE <column> IS NOT NULL` とし、NULL 行の index 維持コストを避ける。`static_artifacts.object_key` には既存の live-object unique index があるため追加しない。

アプリケーションの削除判定は変更せず、参照が1件でも存在すれば削除しない fail-closed 動作を維持する。

## データ損失

なし。テーブル行・URL・R2 object は変更しない。追加されるのは query-plan 用 index のみ。

## ロールバック

0054で追加した6 indexを `DROP INDEX IF EXISTS` で削除する。データ行への復元処理は不要。

## 検証

- `check:db-schema`
- `check:db-history`
- empty / legacy D1 migration validation
- 対象 reference SQL の `EXPLAIN QUERY PLAN` で equality predicate が新 index を利用することを確認
- デプロイ後の D1 Query Insights で対象SQLの `rows_read` を比較
- media cleanup の fail-closed 動作が維持されることを確認
