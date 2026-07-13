# 0041 YouTube Quota Budget

> Status: Active
> Last verified: 2026-07-13
> Source of truth: `migrations/0041_youtube_quota_budget.sql`, `src/lib/db/schema.ts`

対象migration: `0041_youtube_quota_budget.sql`

## 目的

YouTube Data APIを単一キーで運用し、FlameNodeが1日に使用するquotaを設定値の80%以内へ原子的に制限する。WorkerごとのローカルカウンターやKVの結果整合性に依存せず、将来の再生リスト同期を含む全YouTube API処理で同じ予算を共有できるようにする。

## 変更内容

- `external_api_quota_usage`テーブルを追加する。
- `provider`と太平洋時間基準の`quota_day`を複合主キーにする。
- `used_units`と`limit_units`を保存し、上限超過する予約をUPSERTの`WHERE`で拒否する。
- APIキー本体やレスポンス内容は保存しない。

## データ損失

なし。新規テーブル追加のみで、既存行を書き換えない。

## ロールバック

```sql
DROP TABLE IF EXISTS external_api_quota_usage;
```

## 検証

- 空DBへbaselineからactive migrationを順番に適用する。
- `npm run check:db-schema`
- `npm run check:db-history`
- `npm run typecheck`
- `npm run test:workers`
- 同日中の予約が8,000 unitsを超えず、未使用予約が返却されることを確認する。
