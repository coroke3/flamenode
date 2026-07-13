# FlameNode 実装backlog

> Status: Active
> Last verified: 2026-07-13
> Verified against commit: `agent/free-tier-background-worker`
> Source of truth: `src/lib/db/schema.ts`, `migrations/` active path, `docs/operations/README.md`, GitHub Actions CI

この文書は未完了事項と直近の完了項目だけを管理します。schema列一覧、完了仕様の全文、将来案の詳細は複製しません。

## Open

現時点で、添付01〜07仕様に属するコード上の未実装項目はありません。新しい要求を追加する場合は、受入条件、所有文書、必要なschema/migration/testを同じ項目へ記載します。

DB変更をOpenへ追加する場合の完了条件:

- `src/lib/db/schema.ts`を更新
- 新しい連番migrationを追加
- `docs/database/change-log.md`を更新
- `docs/db-history/<migration>.md`を追加
- ローカル空DBへactive migrationを適用
- unit / integration / schema / docs / history検査を成功

## Blocked

以下はリポジトリ外の権限・resourceが必要で、コード変更だけでは完了できません。

- GitHub `production` EnvironmentへのCloudflare / OAuth / Discord / YouTube secretsとVariables登録
- Production D1、R2、KV、Pages project、`flamenode-background-jobs`の実resource確認
- Remote D1のbackup、承認済み`0040_free_tier_background_jobs.sql`適用
- 新Workerのsecret設定、production smoke test、旧3 Workerの削除

これらはsecret不足を成功扱いにせず、production設定検査でfail-closedします。

## Recently completed

- 内部`user_id`、Discord `discord_id`、X `x_user_id`を分離し、旧DB識別子とruntime DDLをactive pathから除去
- `permission_preset='owner'`を代表者の正本にし、最後のowner削除・降格、自己変更、代表移譲を原子的に保護
- 完全before/after監査、復元直前再評価、復元本体・run・RESTORE監査のall-or-nothing化
- 投稿、relation差替、legacy import、spreadsheet、queue/outboxを条件付きSQLとD1 batchへ統一
- 公開判定、公開DTO、R2 artifact追跡、旧artifact削除、pagination、ETagを共通化
- Cron処理を1 Worker・2 Cronへ統合し、通知6件、締切3件、YouTube最大50件、スコア50件、静的生成1件の固定予算を実装
- YouTube同期を`next_sync_at`期限駆動と集合UPSERT、スコアを`score_dirty_at`差分集合UPDATEへ変更
- Pages + `@cloudflare/next-on-pages`、固定artifact、manual-only production deploy workflow、無停止Worker切替、smoke testを整備
- `/entry` 2カード、4step投稿、イベントfilter、ライムtheme、Light/Dark/System、ConsoleShell、mobile drawer、Shelfを実装
- Active / Historical文書、DB change log、migration詳細、文書・DB履歴検査を整理

## 技術的制約

- D1では一般的なinteractive transactionを前提にせず、D1 batch、条件付きSQL、CAS、staging/finalizeで不変条件を守る。
- 監査payload上限やadapter不足で安全に戻せない操作は、理由付き`not_restorable`とする。
- R2/KVは配信用cacheであり、整合性とrepairの正本はD1とする。
- 実外部serviceの到達性はcredentialなしCIでは確認できないため、fixture検査とproduction fail-closed検査を分離する。
