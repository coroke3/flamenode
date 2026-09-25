## 2026-09-25 — `0062_static_artifact_cleanup_index.sql`

| 項目 | 内容 |
| --- | --- |
| Type | additive |
| Summary | live `static_artifacts` のbounded cleanup向けpartial indexを追加 |
| Reason | 相関membership走査をなくしたcleanupで、target絞り込みと `generated_at ASC` の順序をindexで処理するため |
| Tables | `static_artifacts` |
| Data migration | なし |
| Compatibility | index追加のみ。artifact・manifest・公開データは変更しない |
| Data loss | none |
| Rollback | `DROP INDEX IF EXISTS static_artifacts_live_cleanup_idx` |
| Validation | `EXPLAIN QUERY PLAN`、`check:db-schema`、`check:db-history`、SQLite artifact execution tests |
