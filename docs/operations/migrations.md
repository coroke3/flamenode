# Migration 運用

> Status: Active
> Last verified: 2026-08-09
> Verified against commit: `5064ac52`
> Source of truth: `src/lib/db/schema.ts`, `migrations/` active path, `scripts/safe-d1-auto-migrate.mjs`, `docs/database/change-log.md`

## 正本

- DB schemaの唯一の公開正本は `src/lib/db/schema.ts`。
- active migrationは `migrations/` 直下の `NNNN_snake_case.sql` を番号順に適用する。
- 現在のactive pathは `migrations/` 直下のSQLファイル全体であり、番号順に適用する。具体的な適用済み件数・未適用差分は、固定一覧を複製せず `npm run check:db-schema` と `npm run check:db-history` で現行正本から確認する。
- 旧migration本文は `migrations/historical/` に保存する履歴資料であり、現行の適用対象ではない。
- DB変更履歴の正本は [`../database/change-log.md`](../database/change-log.md)。migrationごとの詳細は [`../db-history/README.md`](../db-history/README.md) から確認する。
- D1が整合性の正本であり、R2/KVの静的JSONは公開配信用キャッシュである。

現行コードは旧列・旧tableのruntime fallback、旧方式への二重書き込み、起動時のschema変更を行わない。schema不一致はfail-fastで扱う。

baselineには旧`events.event_group_id`が存在しない。Remote D1をruntimeで自動repairせず、旧環境を破棄・再作成する場合も運用者がbackupと対象を確認して行う。

## ローカル

空のローカルD1には次を実行する。

```sh
npm run db:local-apply
```

このコマンドはactive migrationを一時作業領域へ複製し、D1のtransaction内では
`PRAGMA foreign_keys=OFF`が効かない`0045_align_visibility_defaults.sql`に限って、
従属行の退避・復元を一時コピーへ追加してからWranglerを実行する。適用済みmigration
本文は変更しない。`npx wrangler d1 migrations apply`を直接実行しない。

開発サーバーやWorkerはmigration、ALTER、backfillを自動実行しない。変更後は少なくとも次を実行する。

```sh
npm run check:db-schema
npm run check:db-history
```

`check:db-schema`はactive migrationを番号順に空のSQLiteへ実際に適用し、foreign key、integrity、CHECK、table・列・index・default・FK manifestと`schema.ts`の一致をfail-closedで確認する。`schema.base.ts`は`schema.ts`だけが参照できる内部fragmentであり、アプリ、Worker、テストは必ず`schema.ts`からimportする。

## Remote D1

Remote D1のmigrationは原則として運用者レビュー対象とする。production Workers Buildsで自動適用できる唯一の例外は、`scripts/safe-d1-auto-migrate.mjs` が**未適用migration全件**を検査し、全件が次の条件を満たす場合だけである。

- migration headerが `Type: additive`
- migration headerが `Data loss: none`
- 実行SQLが `CREATE INDEX IF NOT EXISTS ...` または `CREATE UNIQUE INDEX IF NOT EXISTS ...` のみ
- `ALTER` / `DROP` / table作成 / データ更新 / backfillなどを一切含まない

このallow-listを満たさないmigrationが1件でもpendingなら、自動適用は一切行わずWorker deploy前にfail-closedで停止する。0054のような読み取り最適化用の冪等index追加だけがguarded auto-applyの対象であり、一般的なschema migrationを自動化する仕組みではない。

production deployでは次の順序を固定する。

1. Remote `d1_migrations` をSELECT-onlyで読み、未適用migrationを特定する。
2. pendingがある場合、上記allow-listを全件検査する。
3. 全件safeな場合だけ既存のD1互換migration runnerでRemoteへ適用する。
4. 適用後に `d1_migrations` を再取得し、pendingが消えたことを確認する。
5. 既存のstrict read-only schema preflightを改めて実行し、schema version・必須table・全active migrationを再検証する。
6. ここまで成功した場合だけWorker deployを開始する。

safe applyの成功を前提にWorker deployへ進まず、必ずread-backとstrict preflightを通す。D1 write権限が不足する、適用が失敗する、適用後もpendingが残る場合はいずれもWorkerを更新しない。

Remoteへ手動適用する場合は、生成済みWeb設定を指定して安全適用コマンドを使う。

```sh
npm run db:remote-apply -- --config .cloudflare/generated/web.toml
```

このコマンドも`0045`本文自体は変更せず、Wranglerへ渡す一時コピーだけでD1互換処理を行う。
`0045`未適用の実データ入りD1へ生の`wrangler d1 migrations apply`を実行してはならない。

自動適用対象外のmigrationは、schemaとmigrationの差分、backup、適用対象、rollback方針を確認した運用者が手動適用する。CloudflareのD1 migration applyは適用前backupを利用できるが、それを理由に破壊的変更を自動化しない。

Workers Buildsでguarded index migrationを使う場合、Build用 `CLOUDFLARE_API_TOKEN` にはRemote D1の読み取りだけでなくD1 Edit権限も必要になる。権限不足時は安全migration適用段階で停止し、後続Workerをdeployしない。token値やresource IDはlog・Issue・文書へ記録しない。

適用対象や差分は、`migrations/` と `src/lib/db/schema.ts` を照合したうえで検査scriptの結果を正本とする。個別migrationの目的と履歴は [`docs/db-history/README.md`](../db-history/README.md) と [`docs/database/change-log.md`](../database/change-log.md) から確認し、この文書へ一覧を重複記載しない。

Remote D1の初期化や自動削除は行わない。guarded auto-applyの対象をindex-onlyから広げる場合は、別変更として安全性・rollback・partial failureを再設計する。

## 変更手順

1. `src/lib/db/schema.ts`を更新する。
2. 新しい連番active migrationを追加する。既存migration本文を変更しない。
3. migrationヘッダーを [migration template](../templates/migration.md) に従って記載する。
4. [`docs/database/change-log.md`](../database/change-log.md) と対応する `docs/db-history/<migration>.md` を同じ変更で更新する。
5. `npm run check:db-schema`、`npm run check:db-history`、`npm run check:project-docs`を実行する。
6. production自動適用を意図するindex-only migrationは、`scripts/safe-d1-auto-migrate.test.mjs` でallow-list適合とfail-closed回帰を確認する。

rollbackがSQLだけで安全にできない変更は、backupからの運用者による復旧を手順化し、アプリケーションに旧形式fallbackを戻さない。
