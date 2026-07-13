# `0002_terms_reaccept_manual_cost_guard.sql`

> Status: Active
> Date: 2026-07-13
> Type: destructive cleanup + additive indexes/FK
> Source of truth: `src/lib/db/schema.ts`

## 変更概要

major規約公開時の全user更新を廃止し、最新major版と同意履歴から再同意要否を動的に導出する。管理previewと通知は内部`user_id`のkeysetで最大30件ずつ処理し、相関検索とkeysetに必要な4索引を追加する。

`user_tos_consents.user_id`は内部userへの`ON DELETE CASCADE` FKへ強化する。`terms_version_id`はDBに規約版がないfallback同意も保持するため、`terms_versions`へのFKは付けない。

実測collectorが存在しない自動CostGuardはactive runtimeから削除し、手動mode/featureと理由・確認・完全監査を伴う15分限定overrideだけを残す。これに伴い`cost_usage_snapshots`と自動判定専用設定2列を最終schemaから削除する。

## 安全性と運用

- 既存baseline本文は変更せず、`0002`を番号順に手動適用する。
- `user_tos_consents`再構築時に孤立`user_id`があればmigrationをfail-closedにする。
- Remote D1では運用者が対象・backup・孤立行の有無を確認してから適用する。
- Codex、CI、アプリ起動時にRemote migrationや自動repairを実行しない。

## Data loss / Rollback

未計測の`cost_usage_snapshots`と、`system_settings.auto_cost_guard_enabled`、`cost_guard_thresholds_json`を削除する。rollback SQLは提供せず、必要時はmigration前のD1 backupから運用者が復元する。

## 検証

```sh
npm.cmd run check:db-schema
npm.cmd run check:db-history
npm.cmd run check:project-docs
npm.cmd run test:integration
```
