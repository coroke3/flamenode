# 0057_x_id_slot_bind_recovery.sql

> Status: Active
> Date: 2026-08-14
> Type: additive
> Source of truth: `migrations/0057_x_id_slot_bind_recovery.sql`, `src/lib/db/schema.ts`

## 目的

X ID承認transaction後の予約枠bind失敗を `pending` として追跡し、bounded recoveryで再試行できるようにする。

## 変更内容

- `x_identity_requests` に `slot_bind_status`、試行回数、更新時刻を追加
- 承認bind recovery用のpartial indexを追加
- `slots` の reserved・未bind枠を予約者とsnapshot順で検索するpartial indexを追加
- migration前のapproved link/aliasは `slot_bind_updated_at IS NULL` を境界にbounded再検査する
- 既存のslots予約主体列と `slot_reservation_groups` expand構造は維持

## データ損失

なし。既存申請は `slot_bind_status=complete`、試行回数 `0` の既定値で保持し、Recoveryが未検査のapproved link/aliasだけをboundedに再検査する。

## ロールバック

適用前のバックアップを確認したうえで、追加indexは次のSQLで削除できる。列を戻す場合はバックアップから復元する。

```sql
DROP INDEX IF EXISTS x_identity_requests_slot_bind_pending_idx;
DROP INDEX IF EXISTS slots_reserved_unbound_by_owner_snapshot_idx;
```

## 検証

- `npm run check:db-schema`
- `npm run check:db-migration`
- `npm run check:db-history`
- reservation identity / slot bind contract test
- bind対象queryの `EXPLAIN QUERY PLAN`
