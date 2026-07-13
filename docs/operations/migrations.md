# Migration 運用

> Status: Active
> Last verified: 2026-07-13
> Verified against commit: `22e5d52`
> Source of truth: `src/lib/db/schema.ts`, `migrations/` active path

## 正本

- DB schemaの正本は `src/lib/db/schema.ts`。
- active migrationはファイル番号順で適用する。
- 旧migration本文は `migrations/historical/` に保存する履歴資料であり、現行の適用対象ではない。
- D1が正本であり、R2/KVの静的JSONは公開配信用キャッシュである。

現行コードは旧列・旧tableのruntime fallback、旧方式への二重書き込み、起動時のschema変更を行わない。schema不一致はfail-fastで扱う。

baselineには旧`events.event_group_id`が存在しないため、pre-baseline用の
`repair:event-group-legacy` scriptはactive pathから削除済みである。Remote D1を
自動repairせず、旧環境を破棄・再作成する場合も運用者がbackupと対象を確認して行う。

## ローカル

空のローカルD1には次を実行する。

```sh
npm.cmd run db:local-apply
```

開発サーバーやWorkerはmigration、ALTER、backfillを自動実行しない。変更後は少なくとも次を実行する。

```sh
npm.cmd run check:db-schema
npm.cmd run check:db-history
```

`check:db-schema` はactive migrationを番号順に空の`node:sqlite`へ実際に適用し、
`foreign_keys`、`foreign_key_check`、`integrity_check`、CHECK有効化を確認する。
さらに`schema.ts`のtable、列名・SQLite型・nullability・PK順・比較可能なdefault、
named indexのunique属性・列順、foreign key manifestとSQLiteの実体を比較し、
SQL構文エラー、欠落、余分な定義をfail-closedで検出する。defaultは文字列・数値・
`sql`リテラルを正規化して比較し、動的式など静的解析不能な値だけを比較対象外とする。

## Remote D1

Remote D1の作成、backup、migration適用、rollbackは運用者がCloudflareの手順に従い、対象D1とmigrationを確認して明示的に行う。CIとCodexはRemote D1を変更しない。

現行の適用順は次のとおり。

1. `0000_flame_node_baseline.sql`
2. `0001_spreadsheet_import_runs.sql`
3. `0002_terms_reaccept_manual_cost_guard.sql`
4. `0003_large_collaboration_support.sql`
5. `0038_runtime_efficiency_resilience.sql`
6. `0039_search_relation_indexes.sql`
7. `0040_worker_free_tier_scale.sql`

`0001`適用前はSpreadsheet preview/applyがfail-closedになる。先にコードだけをdeployせず、運用者がbackup、migration、Pagesの順序を確認する。

`0002`は`cost_usage_snapshots`と未使用の自動CostGuard設定列を削除し、
`user_tos_consents`をFK付きで再構築する。Remote D1では必ず事前backupを取得し、
孤立した`user_id`がないことを確認してから運用者が明示適用する。Codex/CIは適用しない。

`0003`は`audit_log_settings.max_payload_bytes`のDEFAULTとdefault行の値を
120000へ引き上げる。大規模合作のメンバー集合監査ログ向け。

`0038`と`0039`は高頻度読み取り・検索経路の複合indexとWorker実行状態列を追加する。

`0040`は公開作品のスコア差分更新を固定件数のindex scanで処理するため、
`videos(visibility_status, score_updated_at, id)` indexを追加する。既存行の値は変更しない。

本番適用前に、schemaとmigrationの差分、backup、適用対象、復旧手順を記録する。Remote D1の初期化や自動削除は行わない。

## 変更手順

1. `src/lib/db/schema.ts` を先に更新し、必要なSQLを新しいactive migrationとして追加する。
2. migrationヘッダーを [migration template](../templates/migration.md) に従って記載する。
3. [DB変更履歴](../db-change-history.md) と [DB CHANGELOG](../DB-CHANGELOG.md) を同じ変更で更新する。
4. 旧migrationは書き換えず、必要なら `migrations/historical/` に保持する。
5. `check:db-schema`、`check:db-history`、`check:project-docs` を実行する。

rollbackがSQLだけで安全にできない変更は、backupからの運用者による復旧を手順化し、アプリケーションに旧形式fallbackを戻さない。
