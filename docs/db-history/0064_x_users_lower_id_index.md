# 0064_x_users_lower_id_index.sql

> Status: Active
> Migration: 0064_x_users_lower_id_index.sql
> Date: 2026-10-03
> Type: additive
> Data loss: none
> Rollback: `DROP INDEX IF EXISTS x_users_lower_id_idx`
> Change log: docs/database/change-log.d/0064_x_users_lower_id_index.md
> Source of truth: `migrations/0064_x_users_lower_id_index.sql`, `src/lib/db/schema.ts`

## 目的 (Purpose)

存在しない公開ID（例: ランダムな `/user/<id>`）への匿名アクセスで、`lower(x_users.id) = ?` の照合が `x_users` 全件走査になるのを避ける。

## 変更内容 (Changes)

- `x_users_lower_id_idx`（`lower(id)` の式index）を追加。
- `lower(x_users.id) = ?` のprobe・lookupがindex-backedになる。`x_users.id` に小文字制約はなく旧mixed-case IDが残りうるため、大文字小文字を区別しない照合そのものは維持する。
- `x_users` の書き込みは稀で、index維持の書き込みコストは無視できる。

## データ損失 (Data loss)

なし。既存行・公開項目は変更しない。

## ロールバック (Rollback)

`DROP INDEX IF EXISTS x_users_lower_id_idx`。アプリケーションはindexなしでも同じ結果を返す（走査コストのみ増える）。

## 検証 (Validation)

- `npm run check:db-schema`（式indexはindex_infoで列名なしになるため `<expr>` として照合）
- `npm run check:db-history`
- SQLite `EXPLAIN QUERY PLAN` で `SEARCH x_users USING INDEX x_users_lower_id_idx` を確認

Remote D1への適用は、index-onlyのため guarded auto-apply の対象。明示依頼なしに手動適用しない。
