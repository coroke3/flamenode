# DB CHANGELOG

> Status: Active
> Last verified: 2026-07-12
> Canonical history: [`db-change-history.md`](db-change-history.md)

## 2026-07-11

- `0000_flame_node_baseline.sql` を現行のpre-production baselineとして整理。
- `src/lib/db/schema.ts` をDB schemaの正本として明示。
- 旧migration本文をHistoricalとして保持し、現行runtimeから旧列fallbackと二重書き込みを除外。
- Remote D1 migration/deployは運用者による手動手順だけとし、自動実行しない。
