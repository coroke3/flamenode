# DB CHANGELOG

> Status: Active
> Last verified: 2026-07-12
> Canonical history: [`db-change-history.md`](db-change-history.md)

## 2026-07-11

- `0000_flame_node_baseline.sql` を現行のpre-production baselineとして整理。
- `src/lib/db/schema.ts` をDB schemaの正本として明示。
- 旧migration本文をHistoricalとして保持し、現行runtimeから旧列fallbackと二重書き込みを除外。
- Remote D1 migration/deployは運用者による手動手順だけとし、自動実行しない。

## 2026-07-13

- `0001_spreadsheet_import_runs.sql`を追加。
- Spreadsheet previewの署名nonceを短期保存し、本体mutation・監査と同じD1 batchで一回だけ消費する。
- consumed/expired runは既存`content-jobs` cleanupで上限付き削除する。
- `0002_terms_reaccept_manual_cost_guard.sql`を追加。
- 規約再同意を全user更新ではなく同意履歴とkeyset検索から導出し、必要な索引と`user_tos_consents.user_id` FKを追加。
- 実測collectorのない自動CostGuard列・snapshot tableを削除し、手動mode/featureと15分overrideへ統一。
- `0002`は破壊的cleanupを含むため、Remote D1では運用者がbackup確認後に明示適用する。
- `0003_large_collaboration_support.sql`を追加。
- 大規模合作向けに`audit_log_settings.max_payload_bytes`のDEFAULT/値を120000へ引き上げる。
