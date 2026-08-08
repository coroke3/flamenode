## 2026-08-08 — `0054_media_reference_read_indexes.sql`

| 項目 | 内容 |
| --- | --- |
| Type | additive |
| Summary | public-media orphan/reference check が使う6つの nullable URL 列へ partial equality index を追加 |
| Reason | 参照安全性を維持したまま D1 の全表走査を index lookup へ置き換え、`rows_read` を削減するため |
| Tables | `x_users`, `videos`, `events`, `event_groups`（index のみ） |
| Data migration | なし |
| Compatibility | query結果・削除判定は変更なし。NULL行はpartial indexへ格納しない |
| Data loss | none |
| Rollback | 0054で追加した6 indexを `DROP INDEX IF EXISTS` で削除 |
| Validation | `check:db-schema`, `check:db-history`, empty/legacy D1 migration, deploy後 `EXPLAIN QUERY PLAN` / Query Insights |
| PR | #176 |
