# 0056_admin_operational_count_indexes.sql

> Status: Active
> Date: 2026-08-14
> Type: additive
> Source of truth: `migrations/0056_admin_operational_count_indexes.sql`, `src/lib/db/schema.ts`

## 目的

管理画面の運用件数で参照する pending X identity request と open moderation case の scan 範囲を小さくする。

## 変更内容

- `x_identity_requests(request_type) WHERE status = 'pending'` の partial index を追加
- `video_moderation_cases(due_at) WHERE status = 'open'` の partial index を追加
- 既存の status、期限、監査処理とテーブルデータは変更しない

## データ損失

なし。追加 index のみ。

## ロールバック

適用前のバックアップを確認したうえで、次の index を削除する。

```sql
DROP INDEX IF EXISTS x_identity_requests_pending_type_idx;
DROP INDEX IF EXISTS video_moderation_cases_open_due_idx;
```

## 検証

- `npm run check:db-schema`
- `npm run check:db-migration`
- `npm run check:db-history`
- `EXPLAIN QUERY PLAN` で pending/open の集計が partial index を使用すること
