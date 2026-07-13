# 0038 Runtime Efficiency Resilience

> Status: Active
> Last verified: 2026-07-13
> Source of truth: `migrations/0038_runtime_efficiency_resilience.sql`, `src/lib/db/schema.ts`

対象migration: `0038_runtime_efficiency_resilience.sql`

## 目的

Cron Workerのlease状態を実行後にも確認できるようにし、公開一覧・認証・アイコン補完の頻出読取を全件走査やN+1へ戻さず処理する。

## 変更内容

- `worker_leases`へ最終開始・成功・失敗時刻と安全なエラーコード列を追加する。
- 公開作品の日時順・score順、公開eventの開始時刻順へ複合indexを追加する。
- 承認済みX IDの所有者解決へ複合indexを追加する。
- 作品のcreator icon・表示名fallbackへ部分indexを追加する。

## データ損失

なし。既存行の追加列は`NULL`から開始し、既存の作品・event・X ID・leaseデータを削除しない。

## ロールバック

追加indexは個別に削除できる。`worker_leases`の追加列を除去する必要がある場合は、migration適用前backupから手動復元する。Remote D1へ自動ロールバックしない。

## 検証

- 空DBへbaselineからactive migrationを順番に適用する。
- `npm run check:db-schema`
- `npm run check:db-history`
- `npm run test:workers`
- `npm run test:unit`
