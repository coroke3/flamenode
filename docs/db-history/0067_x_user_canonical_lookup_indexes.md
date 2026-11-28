# 0067_x_user_canonical_lookup_indexes.sql

> Status: Active（PR候補。Remote D1への適用・本番反映は未実施）
> Migration: 0067_x_user_canonical_lookup_indexes.sql
> Date: 2026-11-22
> Type: additive
> Data loss: none
> Rollback: `DROP INDEX IF EXISTS x_user_aliases_canonical_norm_alias_idx; DROP INDEX IF EXISTS x_users_canonical_norm_id_idx;`
> Change log: docs/database/change-log.d/0067_x_user_canonical_lookup_indexes.md
> Source of truth: `migrations/0067_x_user_canonical_lookup_indexes.sql`, `packages/db/src/schema/base.ts`, `packages/db/src/schema/canonical.ts`

## 目的 (Purpose)

MIG-0651（SA-086）では、メンバーX IDを最大100件正規化して照合し、同じD1 write batch内で照合結果を再検査する。既存の `x_users_lower_id_idx` は `lower(id)` のみを索引化しており、実際の `lower(trim(ltrim(trim(id), '@')))` 式には使用できない。別名表の複合主キーも正規化した `alias_x_id` の単独照合には使えない。

## 変更内容 (Changes)

- `x_users_canonical_norm_id_idx`：`x_users` の既存の正規化式をそのまま索引化する非一意式インデックス。
- `x_user_aliases_canonical_norm_alias_idx`：`x_user_aliases.alias_x_id` に同じ正規化を適用する非一意式インデックス。
- 既存の `x_users_lower_id_idx` と別名表の複合主キーを保持する。既存行・承認状態・別名・監査データ・認証ルールは変更しない。旧来の大文字/小文字・先頭 @ の重複候補が存在しても、一意制約を追加せず、既存resolverで曖昧性をfail-closed判定する。
- 同じPRで X ID CAS SQL を100件の直積的な集計CTE結合から、インデックス付き相関集計へ変更する（`packages/server-core/src/video/freeVideoMemberIdentityGuard.ts`）。索引だけを追加しても旧結合の計算量は改善し切らないため両方必要。

## データ損失 (Data loss)

なし。行・既存インデックスを変更しない。

## ロールバック (Rollback)

`DROP INDEX IF EXISTS x_user_aliases_canonical_norm_alias_idx;` と `DROP INDEX IF EXISTS x_users_canonical_norm_id_idx;`。機能の判定結果は変更しないが、照合のCPU性能は低下しうる。

## 検証 (Validation)

- `npm run check:db-schema` / `npm run check:db-history`
- `node --test --experimental-strip-types packages/server-core/test/freeVideoMemberIdentityGuard.test.mjs`（100件のdirect/alias/not-found混合、実際の`EXPLAIN QUERY PLAN`、別名付け替え拒否）
- 合成SQLiteの比較は結果・索引利用を示すだけであり、本番WorkerのCPU性能検証ではない。非本番D1で実際の100件照合、書き込み増分、ストレージとWarm CPUのmax <8msを測定し、50回以上の測定結果をPRへ添付する。

## 適用・承認 Gate

DBスキーマ所有者の独立レビューと各PRのLead明示承認、非本番D1へのexpand順序検証を完了するまではRemote D1へ適用しない。この変更はDraft PR #511内の候補であり、`main` および本番D1への適用は行っていない。
