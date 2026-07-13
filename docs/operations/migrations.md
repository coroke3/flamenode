# Migration 運用

> Status: Active
> Last verified: 2026-07-13
> Verified against commit: `c18c9bb`
> Source of truth: `src/lib/db/schema.ts`, `migrations/` active path, `docs/database/change-log.md`

## 正本

- DB schemaの唯一の公開正本は `src/lib/db/schema.ts`。
- active migrationは `migrations/` 直下の `NNNN_snake_case.sql` を番号順に適用する。
- 現在のactive pathは `0000`、`0001`、`0002`、`0003`、`0038`、`0039`。
- 旧migration本文は `migrations/historical/` に保存する履歴資料であり、現行の適用対象ではない。
- DB変更履歴の正本は [`../database/change-log.md`](../database/change-log.md)。migrationごとの詳細は [`../db-history/README.md`](../db-history/README.md) から確認する。
- D1が整合性の正本であり、R2/KVの静的JSONは公開配信用キャッシュである。

現行コードは旧列・旧tableのruntime fallback、旧方式への二重書き込み、起動時のschema変更を行わない。schema不一致はfail-fastで扱う。

baselineには旧`events.event_group_id`が存在しない。Remote D1を自動repairせず、旧環境を破棄・再作成する場合も運用者がbackupと対象を確認して行う。

## ローカル

空のローカルD1には次を実行する。

```sh
npm run db:local-apply
```

開発サーバーやWorkerはmigration、ALTER、backfillを自動実行しない。変更後は少なくとも次を実行する。

```sh
npm run check:db-schema
npm run check:db-history
```

`check:db-schema`はactive migrationを番号順に空のSQLiteへ実際に適用し、foreign key、integrity、CHECK、table・列・index・default・FK manifestと`schema.ts`の一致をfail-closedで確認する。`schema.base.ts`は`schema.ts`だけが参照できる内部fragmentであり、アプリ、Worker、テストは必ず`schema.ts`からimportする。

## Remote D1

Remote D1の作成、backup、migration適用、rollbackは運用者がCloudflareの手順に従い、対象D1とmigrationを確認して明示的に行う。CIとCodexはRemote D1を変更しない。

現行の適用順は次のとおり。

1. `0000_flame_node_baseline.sql`
2. `0001_spreadsheet_import_runs.sql`
3. `0002_terms_reaccept_manual_cost_guard.sql`
4. `0003_large_collaboration_support.sql`
5. `0038_runtime_efficiency_resilience.sql`
6. `0039_search_relation_indexes.sql`

- `0001`はSpreadsheet preview/applyのone-time nonceを追加する。
- `0002`は規約再同意検索を整備し、未計測の自動CostGuard状態を整理する。table再構築があるため事前backupが必要。
- `0003`は大規模合作の完全監査snapshot向けにpayload上限を引き上げる。
- `0038`はWorker lease実行状態列と公開・認証・アイコン補完用indexを追加する。追加列を読むコードより先に適用する。
- `0039`は公開検索とrelation検索用indexだけを追加し、既存rowを書き換えない。

本番適用前にschemaとmigrationの差分、backup、適用対象、復旧手順を記録する。Remote D1の初期化や自動削除は行わない。

## 変更手順

1. `src/lib/db/schema.ts`を更新する。
2. 新しい連番active migrationを追加する。既存migration本文を変更しない。
3. migrationヘッダーを [migration template](../templates/migration.md) に従って記載する。
4. [`docs/database/change-log.md`](../database/change-log.md) と対応する `docs/db-history/<migration>.md` を同じ変更で更新する。
5. `npm run check:db-schema`、`npm run check:db-history`、`npm run check:project-docs`を実行する。

rollbackがSQLだけで安全にできない変更は、backupからの運用者による復旧を手順化し、アプリケーションに旧形式fallbackを戻さない。
