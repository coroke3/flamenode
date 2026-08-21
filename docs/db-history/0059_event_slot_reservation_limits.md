# 0059_event_slot_reservation_limits.sql

> Status: Active
> Migration: 0059_event_slot_reservation_limits.sql
> Date: 2026-08-21
> Type: additive
> Summary: add event-scoped X ID reservation limits, slot interval guidance, and a bounded logical-reservation guard index
> Data loss: none
> Rollback: restore from a verified D1 backup; indexes may be dropped manually after verification
> Change log: docs/database/change-log.d/0059_event_slot_reservation_limits.md
> Source of truth: `migrations/0059_event_slot_reservation_limits.sql`, `src/lib/db/schema.ts`

## 目的

イベントごとにX ID単位の論理予約枠上限と、連続枠表示に使う枠間隔を設定できるようにする。既存イベントは従来どおり無制限・自動判定とする。

## 変更内容

- `events.max_slot_reservation_groups_per_xid` を追加する。`0` は無制限を表す。
- `events.slot_interval_minutes` を追加する。`NULL` は既存の実枠時刻からの自動判定を表す。
- `slots_event_x_snapshot_active_group_idx` partial indexを追加し、予約・提出済みの論理予約件数ガードをboundedにする。
- 論理予約は連続枠を `reservation_group_id` 単位、単枠・legacyのNULL groupをslot単位で数える。

## データ損失

なし。既存イベントは既定値（上限0、間隔NULL）で保持され、既存の予約状態・表示結果は変わらない。

## ロールバック

適用前のverified D1 backupを正本として復元する。indexだけを先に戻す場合は次を実行できる。

```sql
DROP INDEX IF EXISTS slots_event_x_snapshot_active_group_idx;
```

列を削除する手動DDLやruntime DDLは行わず、完全なロールバックが必要な場合はbackupから復元する。

## 検証

- `npm run check:db-schema`
- `npm run check:db-history`
- `src/lib/slots/slotReservationLimit.contract.test.mjs`
- `src/lib/slots/slotReservationLimitGuard.execution.test.mjs`
- SQLite EXPLAIN / slot reservation unit and integration tests
