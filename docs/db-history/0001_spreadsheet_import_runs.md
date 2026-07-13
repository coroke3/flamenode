# `0001_spreadsheet_import_runs.sql`

> Status: Active
> Date: 2026-07-13
> Type: schema
> Source of truth: `src/lib/db/schema.ts`

## 目的

管理Spreadsheet importのdry-runごとに、署名tokenのnonceと実行メタデータを短期間だけ保存し、applyを一回限りにする。

## 変更内容

管理Spreadsheet importのdry-runごとに、署名tokenのnonce、実行者、対象table、mode、payload/schema hash、有効期限、消費時刻を短期間だけ保存する。

applyはtokenのHMAC署名とclaimsを検証した後、`consumed_at IS NULL AND expires_at >= now`を満たすrunだけを条件付き更新する。この更新、変更件数assertion、本体mutation、監査INSERTは同じD1 batchで実行され、失敗時はrun消費もrollbackされる。

## データ損失

none。短命のrun行を追加するだけで、既存業務データを削除しない。

## ロールバック

運用者が依存コードを停止し、backupを確認したうえでtable/indexを手動削除する。自動rollbackは提供しない。

## 検証

```sh
npm.cmd run check:db-schema
npm.cmd run check:db-history
npm.cmd run test:integration
```
