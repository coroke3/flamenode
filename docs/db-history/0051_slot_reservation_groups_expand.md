# 0051_slot_reservation_groups_expand.sql

> Status: Active  
> Date: 2026-08-02  
> Type: additive  
> Source of truth: `migrations/0051_slot_reservation_groups_expand.sql`, `src/lib/db/schema.ts`

## 目的

枠予約グループ正本となる `slot_reservation_groups` テーブルを追加する（expand 期間は slots 旧列を維持）。

## 変更内容

- `slot_reservation_groups` テーブルを作成
- `event_id` index を追加

## データ損失

なし。新規テーブルのみ。旧列は維持。

## ロールバック

適用前バックアップから復元する。

## 検証

- `npm run check:db-schema`
- `npm run check:db-migration`
- `npm run check:db-history`
- `npm run check:slot-reservation-groups`
