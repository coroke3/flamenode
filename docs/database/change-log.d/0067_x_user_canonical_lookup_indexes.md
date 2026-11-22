## 2026-11-22 — `0067_x_user_canonical_lookup_indexes.sql`

| 項目 | 内容 |
| --- | --- |
| Type | additive（索引2本のみ） |
| Summary | `x_users.id` と `x_user_aliases.alias_x_id` の実際のX ID正規化式 `lower(trim(ltrim(trim(column), '@')))` に一致する非一意式インデックスを追加 |
| Reason | MIG-0651のメンバー照合（最大100件）とD1同一batch内CASが、既存の`lower(id)`索引では全件走査になるため |
| Tables | `x_users`, `x_user_aliases` |
| Data migration | なし。旧来の`@`・大文字・空白を含むIDもそのまま保持 |
| Compatibility | 全インデックス非一意。既存の曖昧IDを自動解決しない。`x_users_lower_id_idx`を保持。認証・権限・監査ポリシー変更なし |
| Data loss | none |
| Rollback | `DROP INDEX IF EXISTS x_user_aliases_canonical_norm_alias_idx; DROP INDEX IF EXISTS x_users_canonical_norm_id_idx;` |
| Validation | `check:db-schema`, `check:db-history`, `freeVideoMemberIdentityGuard.test.mjs`の100人構成 `EXPLAIN QUERY PLAN` と実際のalias retarget拒否。非本番D1で索引容量とWorker warm cpuTimeを別途計測 |
| Deployment gate | D1本番へは未適用。対象migrationの独立スキーマレビュー、Lead承認、expand順序・ロールバックを確認してから適用する |
