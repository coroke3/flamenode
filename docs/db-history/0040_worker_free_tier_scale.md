# 0040 Worker Free Tier Scale

> Status: Active
> Last verified: 2026-07-13
> Verified against branch: `agent/cloudflare-free-tier-scale-v2`
> Source of truth: `migrations/0040_worker_free_tier_scale.sql`, `src/lib/db/schema.ts`

対象migration: `0040_worker_free_tier_scale.sql`

## 目的

Workers FreeのCPU 10ms、D1の1 invocation 50 query、1日100,000 rows writtenを前提に、スコア再計算を全件cursor巡回や1作品1 UPDATEにせず、変更済み・期限切れ作品だけを固定件数で更新する。

## 変更内容

- `videos(visibility_status, score_updated_at, id)` indexを追加する。
- スコア更新対象の`visibility_status = 'public'`と`score_updated_at`による抽出を支援する。
- テーブル、列、既存データ、スコア式は変更しない。

## データ損失

なし。追加するのはindexのみで、既存行を書き換えない。

## ロールバック

```sql
DROP INDEX IF EXISTS videos_score_refresh_idx;
```

## 検証

- 空DBへbaselineからactive migrationを順番に適用する。
- `npm run check:db-schema`
- `npm run check:db-history`
- `npm run typecheck`
- `npm run test:unit`
- migration前後でスコア式と公開作品の並び順が一致することを確認する。
