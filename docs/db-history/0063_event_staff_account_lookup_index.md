# 0063_event_staff_account_lookup_index.sql

> Status: Active
> Migration: 0063_event_staff_account_lookup_index.sql
> Date: 2026-09-30
> Type: additive
> Data loss: none
> Rollback: `DROP INDEX IF EXISTS event_staff_x_event_idx`
> Change log: docs/database/change-log.d/0063_event_staff_account_lookup_index.md
> Source of truth: `migrations/0063_event_staff_account_lookup_index.sql`, `src/lib/db/schema.ts`

## 目的 (Purpose)

ログインアカウントの承認済みX IDから運営権限を取得する際の全件走査を減らす。

## 変更内容 (Changes)

- `event_staff_x_event_idx` を追加。既存のevent起点indexは維持する。
- 大量X IDのJSON1 membershipを非相関の集合比較にし、同indexを使える形にする。
- 権限は従来どおりD1の承認済みlinkとpermission preset/custom keysから判定する。

## データ損失 (Data loss)

なし。既存行・owner・公開項目は変更しない。

## ロールバック (Rollback)

`DROP INDEX IF EXISTS event_staff_x_event_idx`。アプリケーションはindexなしでも同じ結果を返す。

## 検証 (Validation)

- `npm run check:db-schema`
- `npm run check:db-history`
- approved X predicateのSQLite実行で境界値・NULL・重複を検査
- SQLite `EXPLAIN QUERY PLAN` で `SEARCH ... event_staff_x_event_idx` と非相関membershipを検査

Remote D1への適用は明示依頼時のみ行う。
