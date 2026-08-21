## 2026-08-21 — `0059_event_slot_reservation_limits.sql`

| 項目 | 内容 |
| --- | --- |
| Type | additive |
| Summary | イベント単位のX ID予約枠上限、連続枠の間隔ガイダンス、論理予約件数ガード用partial indexを追加 |
| Reason | 予約枠の上限判定をD1のslots正本で原子的に行い、既存イベントの無制限挙動を維持するため |
| Tables | `events`（2列）、`slots`（partial index） |
| Data migration | なし。既存イベントは上限0（無制限）、間隔NULL（自動判定） |
| Compatibility | 既存の予約・連続枠表示は変更せず、上限が明示されたイベントのreserve mutationだけを追加ガードする |
| Data loss | none |
| Rollback | verified backupから復元。indexのみ戻す場合は `DROP INDEX IF EXISTS slots_event_x_snapshot_active_group_idx` |
| Validation | `check:db-schema`, `check:db-history`, slot reservation limit contract / SQLite execution tests |
| PR | #183 |
