# 0053_slot_reserved_x_id_snapshot.sql

> Status: Active  
> Date: 2026-08-07  
> Type: additive  
> Source of truth: `migrations/0053_slot_reserved_x_id_snapshot.sql`, `src/lib/db/schema.ts`

## 目的

枠確保時点の X ID を `slots.reserved_x_id_snapshot` に保存し、Active X 切替や pending 申請後も公開・運営 UI で安定表示する。

## 変更内容

- `slots.reserved_x_id_snapshot` 列を追加
- 既存行は `x_user_id IS NOT NULL` のみ `reserved_x_id_snapshot = x_user_id` でバックフィル
- pending / active X からの推測バックフィルは行わない

## データ損失

なし。旧列 `x_user_id` は維持。

## ロールバック

適用前バックアップから復元する。

## 検証

- `npm run check:db-schema`
- `npm run check:db-history`
- `npm run check:slot-reservation-groups`
- slot / public slots contract test
