# `0003_large_collaboration_support.sql`

> Status: Active
> Date: 2026-07-13
> Type: schema
> Source of truth: `src/lib/db/schema.ts`

## 目的

大規模合作（最大100人）のメンバー集合監査ログを保存できるよう、`audit_log_settings.max_payload_bytes` を引き上げる。

## 変更内容

`audit_log_settings` を再作成し、`max_payload_bytes` の列 DEFAULT を 120000 へ変更する。既存 default 行の値も 120000 未満なら 120000 へ更新する。

## データ損失

none

## ロールバック

migration前のD1 backupから運用者が復元する。または `audit_log_settings` を DEFAULT 20000 で再作成してから行を戻す。
## 検証

```sh
npm.cmd run check:db-schema
npm.cmd run check:db-history
npm.cmd run typecheck
```
