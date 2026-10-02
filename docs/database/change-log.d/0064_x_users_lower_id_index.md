## 2026-10-03 — `0064_x_users_lower_id_index.sql`

| 項目 | 内容 |
| --- | --- |
| Type | additive |
| Summary | `lower(x_users.id)` の式index `x_users_lower_id_idx` を追加 |
| Reason | 公開ユーザーの存在probeとdegraded lookupは大文字小文字を区別しない `lower(x_users.id) = ?` で検索するが、式indexがなく毎回 `x_users` 全件走査になっていたため |
| Tables | `x_users` |
| Data migration | なし |
| Compatibility | index追加のみ。`x_users.id` に小文字制約はなく旧mixed-case IDも残るため、大文字小文字を区別しない照合は維持。公開DTO・権限は不変 |
| Data loss | none |
| Rollback | `DROP INDEX IF EXISTS x_users_lower_id_idx` |
| Validation | SQLite `EXPLAIN QUERY PLAN`、`check:db-schema`、`check:db-history`、schema baseline integration test |
