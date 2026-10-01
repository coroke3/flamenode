## 2026-09-30 — `0063_event_staff_account_lookup_index.sql`

| 項目 | 内容 |
| --- | --- |
| Type | additive |
| Summary | アカウントの運営権限取得用 `event_staff_x_event_idx` を追加 |
| Reason | X IDだけで検索するheader/summaryで `event_staff` 全体を走査しないため |
| Tables | `event_staff` |
| Data migration | なし |
| Compatibility | index追加のみ。permission preset、owner条件、公開DTOは維持 |
| Data loss | none |
| Rollback | `DROP INDEX IF EXISTS event_staff_x_event_idx` |
| Validation | SQLite `EXPLAIN QUERY PLAN`、認可predicate execution tests、`check:db-schema`、`check:db-history` |
