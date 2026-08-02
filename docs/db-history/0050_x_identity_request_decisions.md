# 0050_x_identity_request_decisions.sql

> Status: Active  
> Date: 2026-08-02  
> Type: additive  
> Source of truth: `migrations/0050_x_identity_request_decisions.sql`, `src/lib/db/schema.ts`

## 目的

X ID 申請の判断メタデータと、監査ログの X 主体列を追加する。

## 変更内容

- `x_identity_requests` に `decision_reason` / `decided_by_auth_user_id` / `decided_at` を追加
- `audit_logs` に `actor_x_user_id` を追加

## データ損失

なし。列追加のみ（既存行は NULL）。

## ロールバック

適用前バックアップから復元する。

## 検証

- `npm run check:db-schema`
- `npm run check:db-migration`
- `npm run check:db-history`
- `npm run check:audit-actor-x`
