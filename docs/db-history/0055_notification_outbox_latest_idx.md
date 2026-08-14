# 0055_notification_outbox_latest_idx.sql

> Status: Active
> Date: 2026-08-14
> Type: additive
> Source of truth: `migrations/0055_notification_outbox_latest_idx.sql`, `src/lib/db/schema.ts`

## 目的

`/admin/notifications` の最新 100 件一覧を `created_at` 順で取得する際、全履歴の scan と一時 sort を避ける。

## 変更内容

- `notification_outbox(created_at DESC)` の読み取り用 index を追加
- 配送状態や dedupe 用の既存 index、テーブルデータは変更しない

## データ損失

なし。追加 index のみ。

## ロールバック

適用前のバックアップを確認したうえで `DROP INDEX IF EXISTS notification_outbox_created_idx` を実行する。

## 検証

- `npm run check:db-schema`
- `npm run check:db-migration`
- `npm run check:db-history`
- `EXPLAIN QUERY PLAN` で最新 100 件 query が本 index を使用すること
