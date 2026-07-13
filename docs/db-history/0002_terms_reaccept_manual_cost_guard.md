# `0002_terms_reaccept_manual_cost_guard.sql`

> Status: Active
> Date: 2026-07-13
> Type: cleanup
> Source of truth: `src/lib/db/schema.ts`

## 目的

major規約公開時の全user更新を廃止し、未実装の自動CostGuardを削除して手動overrideだけを残す。

## 変更内容

major規約公開時の全user更新を廃止し、最新major版と同意履歴から再同意要否を動的に導出する。管理previewと通知は内部`user_id`のkeysetで最大30件ずつ処理し、相関検索とkeysetに必要な4索引を追加する。

`user_tos_consents.user_id`は内部userへの`ON DELETE CASCADE` FKへ強化する。実測collectorが存在しない自動CostGuardはactive runtimeから削除し、手動mode/featureと理由・確認・完全監査を伴う15分限定overrideだけを残す。これに伴い`cost_usage_snapshots`と自動判定専用設定2列を最終schemaから削除する。

## データ損失

intentional。未計測の`cost_usage_snapshots`と、`system_settings.auto_cost_guard_enabled`、`cost_guard_thresholds_json`を削除する。

## ロールバック

rollback SQLは提供せず、必要時はmigration前のD1 backupから運用者が復元する。

## 検証

```sh
npm.cmd run check:db-schema
npm.cmd run check:db-history
npm.cmd run check:project-docs
npm.cmd run test:integration
```
